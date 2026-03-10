/**
 * OpenClaw 推广跳转 Worker
 *
 * 部署到 Cloudflare Workers 后，所有推广 ID 只存在于
 * Cloudflare 后台的 Environment Variables 里，源码永远不含真实 ID。
 *
 * 请求格式:  GET https://refer.YOUR_DOMAIN/aliyun
 * 响应:      302 → https://www.aliyun.com/...?userCode=REAL_ID
 */

export interface Env {
  // 在 Cloudflare Dashboard → Workers → Settings → Variables 里设置
  // 或在 wrangler.toml 的 [vars] 里设置（生产环境用 Secrets）
  // ── 云服务器 ──
  AFFILIATE_ALIYUN:       string;   // 阿里云云大使 userCode
  AFFILIATE_TENCENT:      string;   // 腾讯云 CPS cps_key
  AFFILIATE_DIGITALOCEAN: string;   // DigitalOcean refcode
  AFFILIATE_VULTR:        string;   // Vultr ref（纯数字）
  AFFILIATE_LINODE:       string;   // Linode/Akamai ref
  // ── AI 平台 ──
  AFFILIATE_ZHIPU:        string;   // 智谱 AI 邀请码 ic 参数
  FALLBACK_URL:           string;   // 未知路径时的降级页面
}

interface ProviderConfig {
  buildUrl: (id: string) => string;
  fallbackUrl: string;  // ID 未配置时的降级地址（不带 affiliate 参数）
}

const PROVIDERS: Record<string, ProviderConfig> = {
  // ── 云服务器 ────────────────────────────────────────────────────────────────
  aliyun: {
    buildUrl:    (id) => `https://www.aliyun.com/minisite/goods?userCode=${id}`,
    fallbackUrl: "https://www.aliyun.com/product/ecs",
  },
  tencent: {
    buildUrl:    (id) => `https://curl.qcloud.com/${id}`,
    fallbackUrl: "https://cloud.tencent.com/product/cvm",
  },
  digitalocean: {
    buildUrl:    (id) => `https://m.do.co/c/${id}`,
    fallbackUrl: "https://www.digitalocean.com/pricing",
  },
  vultr: {
    buildUrl:    (id) => `https://www.vultr.com/?ref=${id}`,
    fallbackUrl: "https://www.vultr.com/products/cloud-compute/",
  },
  linode: {
    buildUrl:    (id) => `https://www.linode.com/lp/refer/?r=${id}`,
    fallbackUrl: "https://www.linode.com/pricing/",
  },
  // ── AI 平台 ─────────────────────────────────────────────────────────────────
  zhipu: {
    buildUrl:    (id) => `https://www.bigmodel.cn/glm-coding?ic=${id}`,
    fallbackUrl: "https://open.bigmodel.cn/usercenter/apikeys",
  },
};

// 从 Env 对象里取出对应 provider 的 ID
function getAffiliateId(env: Env, provider: string): string {
  const map: Record<string, keyof Env> = {
    aliyun:       "AFFILIATE_ALIYUN",
    tencent:      "AFFILIATE_TENCENT",
    digitalocean: "AFFILIATE_DIGITALOCEAN",
    vultr:        "AFFILIATE_VULTR",
    linode:       "AFFILIATE_LINODE",
    zhipu:        "AFFILIATE_ZHIPU",
  };
  const key = map[provider];
  return key ? (env[key] ?? "") : "";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    // 支持 /aliyun 或 /refer/aliyun 两种路径格式
    const provider = pathname.replace(/^\/(refer\/)?/, "").split("?")[0].toLowerCase();

    const config = PROVIDERS[provider];

    // 未知路径 → 跳到项目主页
    if (!config) {
      const fallback = env.FALLBACK_URL || "https://clawno11.ai";
      return Response.redirect(fallback, 302);
    }

    const id = getAffiliateId(env, provider);
    const target = id ? config.buildUrl(id) : config.fallbackUrl;

    return new Response(null, {
      status: 302,
      headers: {
        "Location": target,
        // 不缓存，便于随时在 Cloudflare 后台修改 ID 即时生效
        "Cache-Control": "no-store, no-cache",
      },
    });
  },
} satisfies ExportedHandler<Env>;
