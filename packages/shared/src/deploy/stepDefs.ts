/**
 * Remote deployment step definitions — shared between desktop and mobile.
 *
 * Each entry maps a translation key to an estimated duration for the progress UI.
 */

export interface RemoteStepDef {
  readonly labelKey: string;
  readonly estimatedSec: number;
}

export const REMOTE_STEP_DEFS: readonly RemoteStepDef[] = [
  { labelKey: "deploy.ssh.steps.remoteConnect",         estimatedSec: 5  },
  { labelKey: "deploy.ssh.steps.remoteCheckNode",       estimatedSec: 60 },
  { labelKey: "deploy.ssh.steps.remoteInstallOpenclaw", estimatedSec: 90 },
  { labelKey: "deploy.ssh.steps.remoteOnboard",         estimatedSec: 5  },
  { labelKey: "deploy.ssh.steps.remoteStart",           estimatedSec: 15 },
] as const;

export const CLAWNO_SERVER_STEP_DEFS: readonly RemoteStepDef[] = [
  { labelKey: "deploy.ssh.steps.remoteInstallClawnoServer", estimatedSec: 60 },
  { labelKey: "deploy.ssh.steps.remoteStartClawnoServer",   estimatedSec: 10 },
] as const;
