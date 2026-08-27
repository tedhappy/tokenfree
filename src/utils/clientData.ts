// 前台客户端数据共享缓存：同名接口全站只请求一次，避免 Hero/SiteList/详情页分别拉取全量 uptime。
// 模块级 Promise 单例，浏览器端多组件复用同一次请求。

let uptimePromise: Promise<Record<string, unknown>> | null = null;

/** 全量可用性数据（前台多处复用），首次调用发起请求，后续复用同一次 Promise。
 *  仅客户端调用；失败时重置以便下次重试。 */
export function fetchUptime(): Promise<Record<string, unknown>> {
  if (!uptimePromise) {
    uptimePromise = fetch('/api/uptime')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d) => (d as Record<string, unknown>) || {})
      .finally(() => {
        uptimePromise = null;
      });
  }
  return uptimePromise;
}
