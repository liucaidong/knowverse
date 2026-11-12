#!/usr/bin/env python3
"""Safely configure KNOWVERSE Staging Edge Function secrets."""
from __future__ import annotations
import getpass, json, os, re, shutil, subprocess, sys, tempfile
from pathlib import Path
from urllib.parse import urlparse

PROJECT_REF = "ypthoicwrfsblaidllyy"
PROJECT_LABEL = "KNOWVERSE Staging"
REQUIRED = (
    ("AI_PROVIDER_API_KEY", "Learning Agent API Key", True),
    ("AI_PROVIDER_MODEL", "Learning Agent model ID", False),
    ("PRACTICE_REVIEWER_API_KEY", "Independent Reviewer API Key", True),
    ("PRACTICE_REVIEWER_MODEL", "Independent Reviewer model ID", False),
)
OPTIONAL_URLS = (
    ("AI_PROVIDER_BASE_URL", "Learning Agent API base URL (blank = OpenAI default)"),
    ("PRACTICE_REVIEWER_API_BASE_URL", "Reviewer API base URL (blank = OpenAI default)"),
)

def run(args, *, check=False, interactive=False):
    return subprocess.run(args, check=check, text=True,
        stdout=None if interactive else subprocess.PIPE,
        stderr=None if interactive else subprocess.PIPE)

def fail(message, code=1):
    print(f"\n错误：{message}", file=sys.stderr)
    raise SystemExit(code)

def install_cli_if_needed():
    binary = shutil.which("supabase")
    if binary:
        return binary
    brew = shutil.which("brew")
    if not brew:
        fail("未找到 Supabase CLI，也未找到 Homebrew。请先按官方文档安装：https://supabase.com/docs/guides/local-development/cli")
    print("未检测到 Supabase CLI。")
    answer = input("是否使用 Homebrew 安装官方 Supabase CLI？[y/N] ").strip().lower()
    if answer not in {"y", "yes"}:
        fail("尚未安装 Supabase CLI。安装后重新运行本命令即可。", 2)
    print("\n正在安装 Supabase CLI（不会修改 KNOWVERSE 项目依赖）...")
    result = run([brew, "install", "supabase/tap/supabase"], interactive=True)
    if result.returncode:
        fail("Supabase CLI 安装失败。请检查 Homebrew 输出后重试。")
    binary = shutil.which("supabase")
    if not binary:
        fail("安装结束，但当前 PATH 中仍找不到 supabase。请重开终端后重试。")
    return binary

def ensure_cli_v3(binary):
    version = run([binary, "--version"])
    version_text = (version.stdout or version.stderr or "").strip()
    match = re.search(r"\b(\d+)\.\d+\.\d+\b", version_text)
    if not match:
        fail(f"无法识别 Supabase CLI 版本：{version_text or 'unknown'}")
    if int(match.group(1)) < 3:
        fail("当前是 Supabase CLI v2。脚本使用 v3 的 --remote 与 --yes 显式目标保护。请先执行 brew upgrade supabase，再重新运行。")

def ensure_project_access(binary):
    result = run([binary, "projects", "list"])
    if result.returncode:
        print("Supabase CLI 尚未登录，或无法读取项目列表。现在启动官方登录流程。")
        login = run([binary, "login"], interactive=True)
        if login.returncode:
            fail("Supabase CLI 登录未完成。登录成功后重新运行本命令。")
        result = run([binary, "projects", "list"])
    if result.returncode:
        fail("无法读取 Supabase 项目列表。请确认 CLI 已登录且网络正常。")
    listing = (result.stdout or "") + "\n" + (result.stderr or "")
    if PROJECT_REF not in listing:
        fail(f"当前 CLI 登录账号看不到 Staging 项目 {PROJECT_REF}。请使用有该项目权限的账号登录；脚本不会改用其他项目。")

def read_inputs():
    values = {}
    print("\n请在本机输入 Staging Provider 配置。")
    print("API Key 使用隐藏输入；不会写入仓库、项目目录或 shell 历史。")
    print("两个模型 ID 必须不同；Reviewer 应使用独立模型，最好也使用独立凭证。\n")
    for name, label, secret in REQUIRED:
        while True:
            value = (getpass.getpass if secret else input)(f"{label} [{name}]: ").strip()
            if not value:
                print("此项为必填，请重新输入。")
                continue
            if any(ch in value for ch in "\r\n\x00"):
                print("输入不能包含换行或空字符，请重新输入。")
                continue
            if secret and (len(value) > 4096 or any(ch.isspace() for ch in value)):
                print("API Key 长度或格式不正确，请重新输入。")
                continue
            if not secret and (len(value) > 200 or not re.fullmatch(r"[A-Za-z0-9._:/+-]+", value)):
                print("模型 ID 格式不正确，请重新输入。")
                continue
            values[name] = value
            break
    if values["AI_PROVIDER_MODEL"].casefold() == values["PRACTICE_REVIEWER_MODEL"].casefold():
        fail("Reviewer 模型必须与 Learning Agent 模型不同；未执行任何远程修改。")
    if values["AI_PROVIDER_API_KEY"] == values["PRACTICE_REVIEWER_API_KEY"]:
        print("提示：两个服务目前使用相同 API Key。建议使用独立 Reviewer 凭证隔离权限与额度。")
    for name, label in OPTIONAL_URLS:
        while True:
            value = input(f"{label} [{name}]: ").strip()
            if not value:
                break
            parsed = urlparse(value)
            if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
                print("必须是有效的 HTTPS Base URL，且不能包含用户名或密码。")
                continue
            if any(ch in value for ch in "\r\n\x00"):
                print("URL 不能包含换行或空字符。")
                continue
            values[name] = value.rstrip("/")
            break
    values["KNOWVERSE_CONTENT_REF"] = "develop"
    return values

def write_env_file(values):
    fd, path = tempfile.mkstemp(prefix="knowverse-staging-secrets-", suffix=".env")
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        for name, value in values.items():
            handle.write(f"{name}={json.dumps(value, ensure_ascii=False)}\n")
    return path

def main():
    if sys.platform != "darwin":
        fail("当前脚本按用户的 macOS 环境设计，仅支持 macOS。")
    root = Path(__file__).resolve().parents[1]
    if not (root / "supabase" / "config.toml").is_file():
        fail("未找到 KNOWVERSE 的 supabase/config.toml；请从仓库脚本启动。")
    print("=" * 64)
    print("KNOWVERSE · Staging AI Secrets 配置")
    print(f"目标项目：{PROJECT_LABEL}")
    print(f"Project Ref：{PROJECT_REF}")
    print("安全边界：仅使用显式 Staging Project Ref，不读取默认 linked project。")
    print("=" * 64)
    binary = install_cli_if_needed()
    ensure_cli_v3(binary)
    ensure_project_access(binary)
    values = read_inputs()
    print("\n即将写入以下变量（只显示名称，不显示值）：")
    for name in values:
        print(f"  • {name}")
    print(f"\n再次确认：目标必须是 {PROJECT_REF}（KNOWVERSE Staging），不是生产项目。")
    confirmation = input("请输入完整 Project Ref 以授权写入：").strip()
    if confirmation != PROJECT_REF:
        fail("Project Ref 确认不匹配，已取消；没有执行远程修改。", 2)
    env_path = write_env_file(values)
    try:
        result = run([binary, "secrets", "set", "--env-file", env_path,
                      f"--remote={PROJECT_REF}", "--yes"])
        if result.returncode:
            stderr = result.stderr or ""
            for value in values.values():
                if value:
                    stderr = stderr.replace(value, "[REDACTED]")
            safe_detail = "\n".join(stderr.strip().splitlines()[-8:])
            fail("Supabase 拒绝写入或写入失败。未打印任何配置值。\n" + (safe_detail or "请检查 CLI 权限与网络。"))
        verify = run([binary, "secrets", "list", f"--remote={PROJECT_REF}"])
        if verify.returncode:
            fail("Secrets 写入命令成功，但读取清单验证失败。请在 Supabase Dashboard 核实变量名称。")
        listing = (verify.stdout or "") + "\n" + (verify.stderr or "")
        missing = [name for name in values if name not in listing]
        if missing:
            fail("Secrets 写入后验证未找到以下变量：" + ", ".join(missing))
        print("\n配置成功。Staging Secrets 清单验证通过：")
        for name in values:
            print(f"  ✓ {name}")
        print("\n密钥值未回显，临时文件将在退出时删除。")
        print("Supabase Edge Functions 会立即读取新 Secrets，无需重新部署。")
        print("尚未发起 AI 模型请求；后续真实 AI 验收可能产生 Provider 费用，需要单独确认后执行。")
    finally:
        try:
            os.remove(env_path)
        except FileNotFoundError:
            pass

if __name__ == "__main__":
    main()
