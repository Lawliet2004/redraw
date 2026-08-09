# THIS FILE IS AUTO-GENERATED. DO NOT MODIFY!!

# Copyright 2020-2023 Tauri Programme within The Commons Conservancy
# SPDX-License-Identifier: Apache-2.0
# SPDX-License-Identifier: MIT

-keep class com.papan_ghosh.redraw.* {
  native <methods>;
}

-keep class com.papan_ghosh.redraw.WryActivity {
  public <init>(...);

  void setWebView(com.papan_ghosh.redraw.RustWebView);
  java.lang.Class getAppClass(...);
  int getId();
  java.lang.String getVersion();
  int startActivity(...);
}

-keep class com.papan_ghosh.redraw.Ipc {
  public <init>(...);

  @android.webkit.JavascriptInterface public <methods>;
}

-keep class com.papan_ghosh.redraw.RustWebView {
  public <init>(...);

  void loadUrlMainThread(...);
  void loadHTMLMainThread(...);
  void evalScript(...);
}

-keep class com.papan_ghosh.redraw.RustWebChromeClient,com.papan_ghosh.redraw.RustWebViewClient {
  public <init>(...);
}
