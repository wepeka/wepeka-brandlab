// One colour per step of a piece (Pemula's Creator: Ide → Script → Syuting →
// Edit → Upload → Tayang), shared by Creator (js/views/creator.js) and the
// Kalender (js/views/calendar.js) so a piece wears the same colour wherever
// it shows. `STEP_COLOR2` is the second hue of a step's gradient.
export const STEP_KEYS = ["idea", "script", "shoot", "edit", "upload", "done"];
export const STEP_COLOR = { idea: "#FFC83D", script: "#3B9BFF", shoot: "#FF9F3D", edit: "#A974FF", upload: "#36D27F", done: "#E9E2D6" };
export const STEP_COLOR2 = { idea: "#FF8A3D", script: "#4F55F5", shoot: "#FF4F4F", edit: "#E04FD8", upload: "#0FA3A3", done: "#C9BFAE" };
export const STATUS_STEP = { idea: "idea", draft: "script", production: "shoot", editing: "edit", scheduled: "upload", published: "done", archived: "done" };
export const stepOfStatus = (status) => STATUS_STEP[status] || "idea";
export const stageColor = (status) => STEP_COLOR[stepOfStatus(status)];
