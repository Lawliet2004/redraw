import { DEFAULT_PAPER, parsePaper, type Paper } from "./paper";
export type Preferences = {
  tabLayout: "horizontal" | "vertical";
  density: "compact" | "comfortable";
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  propertiesVisible: boolean;
  aiMode: "off" | "assist" | "auto";
  appTheme: "system" | "light" | "dark";
  palette: "neutral" | "indigo" | "forest";
  defaultPaper: Paper;
  pinnedPages: string[];
};

export const DEFAULT_PREFERENCES: Preferences = {
  tabLayout: "horizontal",
  density: "compact",
  sidebarCollapsed: false,
  sidebarWidth: 240,
  propertiesVisible: true,
  aiMode: "off",
  appTheme: "system",
  palette: "neutral",
  defaultPaper: DEFAULT_PAPER,
  pinnedPages: [],
};

export function parsePreferences(raw: string | null): Preferences {
  try {
    const p = JSON.parse(raw || "{}");
    return {
      tabLayout: p.tabLayout === "vertical" ? "vertical" : "horizontal",
      density: p.density === "comfortable" ? "comfortable" : "compact",
      sidebarCollapsed: p.sidebarCollapsed === true,
      sidebarWidth:
        typeof p.sidebarWidth === "number" && Number.isFinite(p.sidebarWidth)
          ? Math.min(360, Math.max(200, p.sidebarWidth))
          : 240,
      propertiesVisible: p.propertiesVisible !== false,
      aiMode: p.aiMode === "assist" || p.aiMode === "auto" ? p.aiMode : "off",
      appTheme:
        p.appTheme === "light" || p.appTheme === "dark" ? p.appTheme : "system",
      palette:
        p.palette === "indigo" || p.palette === "forest"
          ? p.palette
          : "neutral",
      defaultPaper: parsePaper(p.defaultPaper),
      pinnedPages: Array.isArray(p.pinnedPages)
        ? p.pinnedPages.filter((id: unknown) => typeof id === "string")
        : [],
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}
