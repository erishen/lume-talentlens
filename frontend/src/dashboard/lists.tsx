// lists.tsx — barrel for the person/repo list + panel components, split by
// concern to keep each file small:
//   people-list.tsx   — PersonChip, PersonList, RADAR_SCORE
//   repo-list.tsx     — RepoRow, BrowsePage
//   scored-panels.tsx — RadarPanel, StargazersPanel, RADAR_MODES
// Existing importers (`./lists`) keep working unchanged.
export { PersonChip, PersonList, RADAR_SCORE } from "./people-list";
export { RepoRow, BrowsePage } from "./repo-list";
export { RadarPanel, StargazersPanel, RADAR_MODES } from "./scored-panels";
