package com.papan_ghosh.redraw

import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Android force-dark was washing tab/label colors to near-invisible gray
    window.decorView.post { disableForceDark(window.decorView) }
  }

  override fun onResume() {
    super.onResume()
    window.decorView.post { disableForceDark(window.decorView) }
  }

  private fun disableForceDark(root: View) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      root.isForceDarkAllowed = false
    }
    if (root is WebView) {
      val s = root.settings
      if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
        @Suppress("DEPRECATION")
        WebSettingsCompat.setForceDark(s, WebSettingsCompat.FORCE_DARK_OFF)
      }
      if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
        WebSettingsCompat.setAlgorithmicDarkeningAllowed(s, false)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        root.isForceDarkAllowed = false
      }
    }
    if (root is android.view.ViewGroup) {
      for (i in 0 until root.childCount) {
        disableForceDark(root.getChildAt(i))
      }
    }
  }
}
