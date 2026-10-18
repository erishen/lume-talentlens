// panels.tsx — barrel for dashboard panels, split by concern:
//   profile-card.tsx  — ProfileCard, OpenToWork (private), linkedinTarget
//   talent-panel.tsx  — TalentPanel, WeightTuner
//   compare-panel.tsx — ComparePanel
//   people-panels.tsx — PushTrend, DiffLine, RelationPanel
// Existing importers (`./panels`) keep working unchanged.
export { ProfileCard, linkedinTarget } from "./profile-card";
export { TalentPanel, WeightTuner } from "./talent-panel";
export { ComparePanel } from "./compare-panel";
export { PushTrend, DiffLine, RelationPanel } from "./people-panels";
