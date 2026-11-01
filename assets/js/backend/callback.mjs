import { createSupabaseAuthClient } from "./auth.mjs";

const root = new URL("../../../", import.meta.url);
const title = document.getElementById("callback-title");
const message = document.getElementById("callback-message");

try {
  const auth = createSupabaseAuthClient();
  if (!auth.enabled) throw new Error("云端配置缺失，请返回 KNOWVERSE 学习驾驶舱检查配置。");
  await auth.handleCallback();
  title.textContent = "账户验证成功";
  message.textContent = "正在返回学习驾驶舱…";
  location.replace(new URL("progress/", root).href);
} catch (error) {
  title.textContent = "账户验证未完成";
  message.textContent = error.message + " 请返回学习驾驶舱重新尝试。";
}
