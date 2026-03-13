import { useState, useRef } from "react";
import { deployRemoteConnect, type SshArgs } from "../../ipc";
import i18n from "../../i18n";
import { translateDetail } from "./translations";
import type { SshAuthMethod } from "./types";

export function useSshForm() {
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState(22);
  const [sshUser, setSshUser] = useState("root");
  const [sshAuthMethod, setSshAuthMethod] = useState<SshAuthMethod>("password");
  const [sshPassword, setSshPassword] = useState("");
  const [sshPrivateKey, setSshPrivateKey] = useState("");
  const [sshGatewayPort, setSshGatewayPort] = useState(18789);
  const [showPassword, setShowPassword] = useState(false);
  const [isTestingConn, setIsTestingConn] = useState(false);
  const [connTestResult, setConnTestResult] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);
  const keyFileRef = useRef<HTMLInputElement>(null);

  const buildSshArgs = (): SshArgs => ({
    host: sshHost.trim(),
    port: sshPort,
    username: sshUser.trim() || "root",
    ...(sshAuthMethod === "password" && sshPassword
      ? { password: sshPassword }
      : {}),
    ...(sshAuthMethod === "key" && sshPrivateKey
      ? { privateKey: sshPrivateKey }
      : {}),
    gatewayPort: sshGatewayPort,
  });

  const handleTestConnection = async () => {
    if (!sshHost.trim()) return;
    const sshArgs = buildSshArgs();
    setIsTestingConn(true);
    setConnTestResult(null);
    try {
      const res = await deployRemoteConnect(sshArgs);
      setConnTestResult({
        ok: res.ok,
        msg: res.ok
          ? i18n.language === "en"
            ? "Connection successful"
            : "连接成功"
          : translateDetail(res.detail),
      });
    } catch (e) {
      setConnTestResult({ ok: false, msg: String(e) });
    } finally {
      setIsTestingConn(false);
    }
  };

  return {
    sshHost,
    setSshHost,
    sshPort,
    setSshPort,
    sshUser,
    setSshUser,
    sshAuthMethod,
    setSshAuthMethod,
    sshPassword,
    setSshPassword,
    sshPrivateKey,
    setSshPrivateKey,
    sshGatewayPort,
    setSshGatewayPort,
    showPassword,
    setShowPassword,
    isTestingConn,
    connTestResult,
    setConnTestResult,
    keyFileRef,
    buildSshArgs,
    handleTestConnection,
  };
}
