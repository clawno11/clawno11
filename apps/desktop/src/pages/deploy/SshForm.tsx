import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  Terminal, Eye, EyeOff, FolderOpen, Info, AlertTriangle,
  Loader, CheckCircle, XCircle, Server,
} from "lucide-react";
import type { SshAuthMethod } from "./types";
import { SSH_USER_PRESETS } from "./types";

interface SshFormProps {
  sshHost: string;
  setSshHost: (v: string) => void;
  sshPort: number;
  setSshPort: (v: number) => void;
  sshUser: string;
  setSshUser: (v: string) => void;
  sshAuthMethod: SshAuthMethod;
  setSshAuthMethod: (v: SshAuthMethod) => void;
  sshPassword: string;
  setSshPassword: (v: string) => void;
  sshPrivateKey: string;
  setSshPrivateKey: (v: string) => void;
  sshGatewayPort: number;
  setSshGatewayPort: (v: number) => void;
  showPassword: boolean;
  setShowPassword: React.Dispatch<React.SetStateAction<boolean>>;
  isTestingConn: boolean;
  connTestResult: { ok: boolean; msg: string } | null;
  setConnTestResult: (v: { ok: boolean; msg: string } | null) => void;
  isDeploying: boolean;
  handleTestConnection: () => void;
  handleRemoteDeploy: () => void;
  keyFileRef: RefObject<HTMLInputElement | null>;
}

export function SshForm(props: SshFormProps) {
  const { t } = useTranslation();
  const {
    sshHost, setSshHost, sshPort, setSshPort, sshUser, setSshUser,
    sshAuthMethod, setSshAuthMethod, sshPassword, setSshPassword,
    sshPrivateKey, setSshPrivateKey, sshGatewayPort, setSshGatewayPort,
    showPassword, setShowPassword, isTestingConn, connTestResult, setConnTestResult,
    isDeploying, handleTestConnection, handleRemoteDeploy, keyFileRef,
  } = props;

  return (
    <div className="mb-5 space-y-3">

      {/* ── SSH 连接信息指南（始终展开） ── */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 bg-muted/10 border-b border-border/50">
          <Info size={14} className="text-primary flex-shrink-0" />
          <span className="text-sm font-medium text-foreground">{t("deploy.ssh.whereToFind")}</span>
          <span className="text-xs text-muted-foreground hidden sm:inline">{t("deploy.ssh.whereToFindSub")}</span>
        </div>
        <div className="px-4 pb-4 pt-3 bg-muted/10">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left py-1.5 pr-3 font-medium w-24">填写内容</th>
                  <th className="text-left py-1.5 pr-3 font-medium">阿里云 ECS</th>
                  <th className="text-left py-1.5 pr-3 font-medium">腾讯云 CVM</th>
                  <th className="text-left py-1.5 font-medium">AWS EC2</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                <tr>
                  <td className="py-2 pr-3 font-medium text-foreground">公网IP</td>
                  <td className="py-2 pr-3 text-muted-foreground">实例详情 → <span className="font-semibold text-foreground">公网IP</span></td>
                  <td className="py-2 pr-3 text-muted-foreground">实例详情 → <span className="font-semibold text-foreground">公网IP</span></td>
                  <td className="py-2 text-muted-foreground">实例 → <span className="font-semibold text-foreground">Public IPv4</span></td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-medium text-foreground">用户名</td>
                  <td className="py-2 pr-3 text-muted-foreground">Alibaba Linux / CentOS: <b>root</b><br/>Ubuntu 镜像: <b>root</b></td>
                  <td className="py-2 pr-3 text-muted-foreground">Ubuntu: <b>ubuntu</b><br/>其他镜像: <b>root</b></td>
                  <td className="py-2 text-muted-foreground">Amazon Linux: <b>ec2-user</b><br/>Ubuntu: <b>ubuntu</b></td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-medium text-foreground">认证方式</td>
                  <td className="py-2 pr-3 text-muted-foreground">创建时选密码→用密码<br/>选密钥对→用 .pem</td>
                  <td className="py-2 pr-3 text-muted-foreground">创建时选密码→用密码<br/>绑定密钥→用 .pem</td>
                  <td className="py-2 text-muted-foreground">通常为密钥对<br/>（创建实例时下载 .pem）</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2.5 leading-relaxed">
            💡 忘记密码？登录云厂商控制台 → 实例详情 → 重置实例密码
          </p>
        </div>
      </div>

      {/* ── ② Connection card ── */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Terminal size={15} className="text-primary" />
          <p className="text-sm font-semibold">{t("deploy.ssh.title")}</p>
          <span className="ml-auto text-[10px] text-muted-foreground">{t("deploy.ssh.tipLinuxOnly")}</span>
        </div>

        {/* Host + SSH Port */}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 space-y-1">
            <label className="text-xs text-muted-foreground block">{t("deploy.ssh.host")}</label>
            <input
              type="text"
              value={sshHost}
              onChange={(e) => { setSshHost(e.target.value); setConnTestResult(null); }}
              placeholder={t("deploy.ssh.hostPlaceholder")}
              disabled={isDeploying}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
            <p className="text-[10px] text-muted-foreground">{t("deploy.ssh.hostHint")}</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground block">{t("deploy.ssh.port")}</label>
            <input
              type="number"
              value={sshPort}
              onChange={(e) => setSshPort(Number(e.target.value) || 22)}
              disabled={isDeploying}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
            <p className="text-[10px] text-muted-foreground">{t("deploy.ssh.portHint")}</p>
          </div>
        </div>

        {/* Username + quick-select chips */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground block">{t("deploy.ssh.username")}</label>
          <input
            type="text"
            value={sshUser}
            onChange={(e) => setSshUser(e.target.value)}
            placeholder="root"
            disabled={isDeploying}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          />
          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
            <span className="text-[10px] text-muted-foreground">{t("deploy.ssh.usernameQuickLabel")}</span>
            {SSH_USER_PRESETS.map(({ user, hint }) => (
              <button
                key={user}
                type="button"
                onClick={() => setSshUser(user)}
                disabled={isDeploying}
                title={hint}
                className={`text-[10px] px-2 py-0.5 rounded border transition-colors disabled:opacity-40 ${
                  sshUser === user
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
              >
                {user}
              </button>
            ))}
          </div>
        </div>

        {/* Auth method toggle */}
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground block">{t("deploy.ssh.authMethod")}</label>
          <div className="grid grid-cols-2 gap-2">
            {(["password", "key"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setSshAuthMethod(m)}
                disabled={isDeploying}
                className={`py-2 px-3 rounded-lg border text-left transition-colors disabled:opacity-50 ${
                  sshAuthMethod === m
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40"
                }`}
              >
                <div className="text-xs font-semibold">
                  {m === "password" ? `🔑 ${t("deploy.ssh.authPassword")}` : `🗝️ ${t("deploy.ssh.authKey")}`}
                </div>
                <div className="text-[10px] opacity-60 mt-0.5">
                  {m === "password" ? t("deploy.ssh.authPasswordHint") : t("deploy.ssh.authKeyHint")}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Password field */}
        {sshAuthMethod === "password" && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground block">{t("deploy.ssh.password")}</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={sshPassword}
                onChange={(e) => setSshPassword(e.target.value)}
                placeholder={t("deploy.ssh.passwordPlaceholder")}
                disabled={isDeploying}
                className="w-full px-3 py-2 pr-9 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        )}

        {/* Private key field */}
        {sshAuthMethod === "key" && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground">{t("deploy.ssh.privateKey")}</label>
              <button
                type="button"
                onClick={() => keyFileRef.current?.click()}
                disabled={isDeploying}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors disabled:opacity-40"
              >
                <FolderOpen size={12} />
                {t("deploy.ssh.privateKeyPickFile")}
              </button>
            </div>
            {/* Hidden file input */}
            <input
              ref={keyFileRef}
              type="file"
              accept=".pem,.key,.txt"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (evt) => setSshPrivateKey((evt.target?.result as string) ?? "");
                reader.readAsText(file);
                e.target.value = "";
              }}
            />
            <textarea
              value={sshPrivateKey}
              onChange={(e) => setSshPrivateKey(e.target.value)}
              placeholder={t("deploy.ssh.privateKeyPlaceholder")}
              disabled={isDeploying}
              rows={5}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 resize-none"
            />
            <p className="text-[10px] text-muted-foreground">{t("deploy.ssh.tipAuth")}</p>
          </div>
        )}

        {/* Gateway port + security group warning */}
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground block">{t("deploy.ssh.gatewayPort")}</label>
          <input
            type="number"
            value={sshGatewayPort}
            onChange={(e) => setSshGatewayPort(Number(e.target.value) || 18789)}
            disabled={isDeploying}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          />
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300">
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
            <p className="text-[11px] leading-relaxed">{t("deploy.ssh.securityGroupWarn")}</p>
          </div>
        </div>
      </div>

      {/* ── ③ Test connection ── */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleTestConnection}
          disabled={isTestingConn || isDeploying || !sshHost.trim() || (sshAuthMethod === "password" ? !sshPassword : !sshPrivateKey.trim())}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm font-medium
                     hover:bg-muted/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isTestingConn
            ? <Loader size={14} className="animate-spin" />
            : <Terminal size={14} />}
          {isTestingConn ? t("deploy.ssh.connecting") : t("deploy.ssh.connect")}
        </button>

        {connTestResult && !isTestingConn && (
          <div className={`flex items-center gap-1.5 ${connTestResult.ok ? "text-green-600" : "text-red-500"}`}>
            {connTestResult.ok ? <CheckCircle size={14} /> : <XCircle size={14} />}
            <span className="text-xs">{connTestResult.msg}</span>
          </div>
        )}
      </div>

      {/* ── ④ Deploy button ── */}
      <button
        onClick={() => handleRemoteDeploy()}
        disabled={isDeploying || !sshHost.trim() || (sshAuthMethod === "password" ? !sshPassword : !sshPrivateKey.trim())}
        className="w-full py-3 px-4 bg-primary text-primary-foreground rounded-xl font-semibold
                   hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed
                   transition-colors flex items-center justify-center gap-2"
      >
        <Server size={16} />
        {t("deploy.ssh.startRemoteDeploy")}
      </button>
    </div>
  );
}
