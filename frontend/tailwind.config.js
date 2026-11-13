/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  // Button builds its class name dynamically (`btn-${variant}`), which Tailwind's scanner cannot see; without this the
  // component classes that are never written out literally (btn-danger) are purged from the build.
  safelist: ["btn-primary", "btn-soft", "btn-danger", "btn-ghost"],
  theme: {
    extend: {
      fontFamily: { sans: ['"Figtree Variable"', "ui-sans-serif", "system-ui", "Segoe UI", "sans-serif"] },
      colors: {
        canvas: "#E6EAE8",
        surface: "#F1F4F2",
        ink: { DEFAULT: "#25302E", soft: "#4B5955", mute: "#667470" },
        slate: { brand: "#3F5F7A", deep: "#304B62", tint: "#DAE5EE" },
        sage: { DEFAULT: "#3F7058", tint: "#DCEBE3", ink: "#2B5340" },
        amber: { clay: "#8A5E17", tint: "#F3E7CE", ink: "#6B4710" },
        brick: { DEFAULT: "#A04A42", tint: "#F2DCD9", ink: "#823832" },
        stone: { tint: "#E2E7E5" },
      },
      borderRadius: { clay: "22px", well: "14px" },
      boxShadow: {
        clay: "9px 9px 22px rgba(118,134,129,.30), -8px -8px 20px rgba(255,255,255,.80), inset 1px 1px 0 rgba(255,255,255,.75)",
        "clay-sm": "5px 5px 12px rgba(118,134,129,.28), -4px -4px 10px rgba(255,255,255,.80), inset 1px 1px 0 rgba(255,255,255,.7)",
        well: "inset 3px 3px 7px rgba(118,134,129,.28), inset -3px -3px 7px rgba(255,255,255,.90)",
        press: "inset 3px 3px 8px rgba(40,60,78,.45), inset -2px -2px 5px rgba(255,255,255,.12)",
      },
    },
  },
  plugins: [],
};
