import { execFileSync, spawnSync } from "node:child_process";
import { chownSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "../log.js";
import type { AgentIdentity } from "./sdkRunner.js";

/**
 * The agent's own unix user (ADR 0047). Its processes are that user's: they cannot read the
 * service process's memory or environment, where the Anthropic key, the GitHub App's key, the
 * session secret and the database's address are, and they own nothing on the volume but a home
 * and the worktree of the draft they are working on. Only root can become another user, so this
 * answers null anywhere else, and in production the chat stays off without it.
 */
export function ensureAgentUser(name: string, dir: string, log: Logger): AgentIdentity | null {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) return null;
  const id = (flag: "-u" | "-g"): number => Number(execFileSync("id", [flag, name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
  const home = join(dir, "agent-home");
  try {
    let uid: number;
    try {
      uid = id("-u");
    } catch {
      // No login, no password, and a home on the volume so a session's transcript outlasts a deploy.
      execFileSync("useradd", ["--system", "--user-group", "--no-create-home", "--home-dir", home, "--shell", "/bin/bash", name], { stdio: "ignore" });
      uid = id("-u");
      log.info({ user: name, uid }, "made the agent's unix user");
    }
    const gid = id("-g");
    if (uid === 0) throw new Error(`${name} is root`);
    mkdirSync(home, { recursive: true });
    chownSync(home, uid, gid);
    // The worktree's files are the agent's and the clone behind them is the service's: git would refuse to read
    // across that line unasked. Reading is all it can do there; the clone is not the agent's to write.
    writeFileSync(join(home, ".gitconfig"), "[safe]\n\tdirectory = *\n");
    chownSync(join(home, ".gitconfig"), uid, gid);
    // A volume the agent's user cannot walk into is a chat whose every step fails. Better to say so once, here.
    if (spawnSync("test", ["-x", dir, "-a", "-w", home], { uid, gid }).status !== 0) throw new Error(`${name} cannot reach ${dir}: every directory above it must let other users in`);
    return { uid, gid, home };
  } catch (err) {
    log.error({ err, user: name }, "could not make the agent's unix user");
    return null;
  }
}
