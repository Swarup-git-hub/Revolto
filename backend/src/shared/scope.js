import Team from "../models/Team.js";
import { forbidden, notFound } from "./errors.js";
import { isObjectId } from "./validate.js";

/** Mongo filter describing the teams a user may see. Applied on the server for every team-related query. */
export function teamScopeFilter(user) {
  switch (user.role) {
    case "hod":
      return {};
    case "coordinator":
      return { section: { $in: user.sections } };
    case "guide":
      return { guide: user._id };
    default:
      return user.team ? { _id: user.team } : { _id: null };
  }
}

/** Sections whose data the user may see (null = all). */
export function sectionScope(user) {
  if (user.role === "hod") return null;
  if (user.role === "coordinator") return user.sections;
  return [];
}

export const inCoordinatorScope = (user, sectionId) => user.role === "hod" || (user.role === "coordinator" && user.sections.includes(String(sectionId)));

/** HOD, or the Coordinator of the team's section. */
export const canManageStructure = (user, team) => inCoordinatorScope(user, team.section);

/** Loads a team by Mongo id or human teamId, only if it is inside the user's scope. Out-of-scope looks like "not found". */
export async function loadScopedTeam(user, idOrTeamId, projection) {
  const key = String(idOrTeamId);
  const idFilter = isObjectId(key) ? { _id: key } : { teamId: key.toUpperCase() };
  const team = await Team.findOne({ ...idFilter, $and: [teamScopeFilter(user)] }, projection);
  if (!team) throw notFound("Team not found");
  return team;
}

export function requireTeamLeader(user, team) {
  if (user.role !== "student" || !team.leader || String(team.leader) !== user.id) throw forbidden("Only the team leader can submit for the team");
}
