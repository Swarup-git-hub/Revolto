import { Users } from "lucide-react";
import { Card, EmptyState, PageHeader } from "../components/ui/index.jsx";
import { useAuth } from "../store/auth.js";
import TeamView from "./TeamDetail.jsx";

export default function MyProject() {
  const user = useAuth((s) => s.user);
  if (!user.team) return <><PageHeader title="My project" /><Card><EmptyState icon={Users} title="You are not part of a team yet" hint="Your coordinator or guide will add you to a team." /></Card></>;
  return <TeamView teamId={user.team.id} />;
}
