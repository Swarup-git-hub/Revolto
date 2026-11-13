import { GraduationCap, MailCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Alert, Button } from "../components/ui/index.jsx";
import { Input } from "../components/ui/fields.jsx";
import { api, describeError } from "../lib/api.js";
import { useAuth } from "../store/auth.js";

export default function Login() {
  const { token, login } = useAuth();
  const [step, setStep] = useState("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  if (token) return <Navigate to="/" replace />;

  const send = async (e) => {
    e?.preventDefault();
    setBusy(true); setError("");
    try {
      const { data } = await api.post("/auth/send-otp", { email: email.trim() });
      setStep("code"); setWait(data.retryAfterSeconds || 60);
    } catch (err) {
      const d = describeError(err);
      // Cooling down means a code was sent moments ago: let the person enter it instead of blocking them.
      if (err.response?.status === 429 && /^Please wait/.test(d.message)) { setStep("code"); const m = /(\d+) seconds/.exec(d.message); setWait(m ? Number(m[1]) : 30); setError(""); }
      else setError(d.message);
    } finally { setBusy(false); }
  };
  const verify = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const { data } = await api.post("/auth/verify-otp", { email: email.trim(), otp: code.trim() });
      login(data.token, data.user);
    } catch (err) { setError(describeError(err).message); } finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <div className="clay rise w-full max-w-[440px] p-8">
        <div className="mb-6 flex items-center gap-4">
          <span className="well grid h-14 w-14 place-items-center text-slate-brand"><GraduationCap size={28} /></span>
          <div>
            <h1 className="text-[22px] font-bold leading-tight">Review Management System</h1>
            <p className="text-[14px] text-ink-soft">Project progress, reviews and final reports</p>
          </div>
        </div>

        {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

        {step === "email" ? (
          <form onSubmit={send} className="space-y-4" noValidate>
            <Input label="College email address" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} help="We will email you a 6-digit sign-in code." />
            <Button type="submit" className="w-full" loading={busy} disabled={!email.includes("@")} onClick={send}>Send sign-in code</Button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-4">
            <Alert tone="info"><span className="inline-flex items-center gap-1.5"><MailCheck size={15} />If <strong>{email}</strong> is registered, a code is on its way. It expires in 5 minutes.</span></Alert>
            <Input label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="[&_input]:text-center [&_input]:text-[22px] [&_input]:tracking-[0.5em]" />
            <Button type="submit" className="w-full" loading={busy} disabled={code.length !== 6}>Sign in</Button>
            <div className="flex items-center justify-between text-[13.5px]">
              <button type="button" className="font-semibold text-slate-brand underline disabled:text-ink-mute disabled:no-underline" disabled={wait > 0 || busy} onClick={send}>{wait > 0 ? `Resend code in ${wait}s` : "Resend code"}</button>
              <button type="button" className="font-semibold text-ink-soft underline" onClick={() => { setStep("email"); setCode(""); setError(""); }}>Use a different email</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
