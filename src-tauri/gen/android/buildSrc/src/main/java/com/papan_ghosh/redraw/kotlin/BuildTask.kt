import java.io.File
import org.apache.tools.ant.taskdefs.condition.Os
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.logging.LogLevel
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction

open class BuildTask : DefaultTask() {
    @Input
    var rootDirRel: String? = null
    @Input
    var target: String? = null
    @Input
    var release: Boolean? = null

    @TaskAction
    fun assemble() {
        val rootDirRel = rootDirRel ?: throw GradleException("rootDirRel cannot be null")
        val target = target ?: throw GradleException("target cannot be null")
        val srcTauri = File(project.projectDir, rootDirRel).canonicalFile
        val projectRoot = srcTauri.parentFile

        // ponytail: Windows without Developer Mode can't symlink; copy .so if already built
        val abi = when (target) {
            "aarch64" -> "arm64-v8a"
            "armv7" -> "armeabi-v7a"
            "i686" -> "x86"
            "x86_64" -> "x86_64"
            else -> target
        }
        val cargoTarget = when (target) {
            "aarch64" -> "aarch64-linux-android"
            "armv7" -> "armv7-linux-androideabi"
            "i686" -> "i686-linux-android"
            "x86_64" -> "x86_64-linux-android"
            else -> "$target-linux-android"
        }
        val profile = if (release == true) "release" else "debug"
        val cargoDir = System.getenv("CARGO_TARGET_DIR") ?: "C:\\src\\redraw-target"
        val builtSo = File("$cargoDir/$cargoTarget/$profile/libtauri_app_lib.so")
        val jniSo = File(project.projectDir, "src/main/jniLibs/$abi/libtauri_app_lib.so")

        if (System.getenv("REDRAW_SKIP_RUST") == "1") {
            if (builtSo.exists()) {
                jniSo.parentFile.mkdirs()
                builtSo.copyTo(jniSo, overwrite = true)
                logger.lifecycle("REDRAW_SKIP_RUST=1 — copied ${builtSo.path}")
                return
            }
            if (jniSo.exists()) {
                logger.lifecycle("REDRAW_SKIP_RUST=1 — reusing ${jniSo.path}")
                return
            }
            throw GradleException("REDRAW_SKIP_RUST=1 but no lib for $abi at $builtSo or $jniSo")
        }

        try {
            val tauriCmd = File(projectRoot, "node_modules/.bin/tauri.cmd")
            val tauriJs = File(projectRoot, "node_modules/@tauri-apps/cli/tauri.js")
            when {
                tauriCmd.exists() && Os.isFamily(Os.FAMILY_WINDOWS) ->
                    runTauriCli(tauriCmd.absolutePath, projectRoot, useNode = false)
                tauriJs.exists() ->
                    runTauriCli(tauriJs.absolutePath, projectRoot, useNode = true)
                else ->
                    throw GradleException("tauri CLI not found under ${projectRoot}")
            }
        } catch (e: Exception) {
            if (builtSo.exists()) {
                logger.warn("tauri android-studio-script failed (often symlink on Windows); copying ${builtSo.path}")
                jniSo.parentFile.mkdirs()
                builtSo.copyTo(jniSo, overwrite = true)
                return
            }
            throw e
        }

        if (builtSo.exists() && (!jniSo.exists() || builtSo.lastModified() > jniSo.lastModified())) {
            jniSo.parentFile.mkdirs()
            builtSo.copyTo(jniSo, overwrite = true)
        }
    }

    fun runTauriCli(cli: String, workingDir: File, useNode: Boolean) {
        val target = target ?: throw GradleException("target cannot be null")
        val release = release ?: throw GradleException("release cannot be null")

        project.exec {
            workingDir(workingDir)
            if (useNode) {
                executable("node")
                args(cli)
            } else {
                executable(cli)
            }
            args("android", "android-studio-script")
            if (project.logger.isEnabled(LogLevel.DEBUG)) {
                args("-vv")
            } else if (project.logger.isEnabled(LogLevel.INFO)) {
                args("-v")
            }
            if (release) {
                args("--release")
            }
            args(listOf("--target", target))
            // Windows NDK .cmd linker breaks on paths with spaces
            environment("CARGO_TARGET_DIR", "C:\\src\\redraw-target")
            environment("NDK_HOME", System.getenv("NDK_HOME") ?: "C:\\src\\android-sdk\\ndk\\26.1.10909125")
            environment("ANDROID_HOME", System.getenv("ANDROID_HOME") ?: "C:\\src\\android-sdk")
        }.assertNormalExitValue()
    }
}