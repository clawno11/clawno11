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
        runTauriCli()
    }

    fun runTauriCli() {
        val rootDirRel = rootDirRel ?: throw GradleException("rootDirRel cannot be null")
        val target = target ?: throw GradleException("target cannot be null")
        val release = release ?: throw GradleException("release cannot be null")

        val workDir = File(project.projectDir, rootDirRel)

        // Resolve node executable (node.exe on Windows, node on Unix)
        val nodeExe = if (Os.isFamily(Os.FAMILY_WINDOWS)) "node.exe" else "node"

        // Resolve tauri CLI script from the npm project root (node_modules)
        val tauriCliScript = File(workDir, "node_modules/@tauri-apps/cli/tauri.js").canonicalPath

        val args = listOf(tauriCliScript, "android", "android-studio-script")

        project.exec {
            workingDir(workDir)
            executable(nodeExe)
            args(args)
            if (project.logger.isEnabled(LogLevel.DEBUG)) {
                args("-vv")
            } else if (project.logger.isEnabled(LogLevel.INFO)) {
                args("-v")
            }
            if (release) {
                args("--release")
            }
            args(listOf("--target", target))
        }.assertNormalExitValue()
    }
}