import { MainMenu } from "@excalidraw/excalidraw";
export default function RedrawMenu({
  onSettings,
  onPages,
  onFocus,
  onExport,
  onInsertImage,
  onTheme,
}: {
  onSettings: () => void;
  onPages: () => void;
  onFocus: () => void;
  onExport: () => void;
  onInsertImage: () => void;
  onTheme: () => void;
}) {
  return (
    <MainMenu>
      <MainMenu.DefaultItems.Export />
      <MainMenu.Item onSelect={onInsertImage}>Insert image…</MainMenu.Item>
      <MainMenu.Item onSelect={onExport}>Export image…</MainMenu.Item>
      <MainMenu.DefaultItems.SearchMenu />
      <MainMenu.Separator />
      <MainMenu.Item onSelect={onPages}>All pages</MainMenu.Item>
      <MainMenu.Item onSelect={onSettings}>Settings</MainMenu.Item>
      <MainMenu.Item onSelect={onFocus} shortcut="Ctrl+Shift+F">
        Focus mode
      </MainMenu.Item>
      <MainMenu.Separator />
      <MainMenu.Item onSelect={onTheme}>
        Toggle light / dark interface
      </MainMenu.Item>
      <MainMenu.DefaultItems.ChangeCanvasBackground />
      <MainMenu.Separator />
      <MainMenu.DefaultItems.ClearCanvas />
    </MainMenu>
  );
}
