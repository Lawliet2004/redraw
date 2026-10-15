import { DEFAULT_PAPER, parsePaper, type Paper } from "./paper";
import {
  DEFAULT_SMART_INK,
  parseSmartInkSettings,
  type SmartInkSettings,
} from "./smartink/types";
export type Preferences = {
  density: "compact" | "comfortable";
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  propertiesVisible: boolean;
  aiMode: "off" | "assist" | "auto";
  appTheme: "system" | "light" | "dark";
  palette: "neutral" | "indigo" | "forest";
  defaultPaper: Paper;
  pinnedPages: string[];
  smartInk: SmartInkSettings;
};

export const DEFAULT_PREFERENCES: Preferences = {
  density: "compact",
  sidebarCollapsed: false,
  sidebarWidth: 240,
  propertiesVisible: true,
  aiMode: "off",
  appTheme: "system",
  palette: "neutral",
  defaultPaper: DEFAULT_PAPER,
  pinnedPages: [],
  smartInk: DEFAULT_SMART_INK,
};

export function parsePreferences(raw: string | null): Preferences {
  try {
    const p = JSON.parse(raw || "{}");
    return {
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
      smartInk: parseSmartInkSettings(p.smartInk),
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}
