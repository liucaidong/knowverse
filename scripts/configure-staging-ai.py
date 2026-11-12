#!/usr/bin/env python3
"""Safely configure KNOWVERSE Staging Edge Function secrets from a local JSON file."""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

PROJECT_REF = "ypthoicwrfsblaidllyy"
PROJECT_LABEL = "KNOWVERSE Staging"
REQUIRED = (
    "AI_PROVIDER_API_KEY",
    "AI_PROVIDER_MODEL",
    "PRACTICE_REVIEWER_API_KEY",
    "PRACTICE_REVIEWER_MODEL",
)
OPTIONAL_URLS = (
    "AI_PROVIDER_BASE_URL",
    "PRACTICE_REVIEWER_API_BASE_URL",
)
ALLOWED_KEYS = set(REQUIRED + OPTIONAL_URLS)


def run(args, *, interactive=False):
    return subprocess.run(
        args,
        text=True,
        stdout=None if interactive else subprocess.PIPE,
        stderr=None if interactive else subprocess.PIPE,
    )


def fail(message, code=1):
    print(f"\n错误：{message}", file=sys.stderr)
    raise SystemExit(code)


def parse_config(config_path: Path, template_path: Path):
    if not config_path.exists():
        config_path.parent.mkdir(parents=True, exist_ok=True)
        if not template_path.is_file():
            fail(f"配置模板不存在：{template_path}")
        shutil.copyfile(template_path, config_path)
        os.chmod(config_path, 0o600)
        print("已生成本机专用配置文件（权限 0600）：")
        print(f"  {config_path}")
        print("\n请编辑该 JSON 文件，填写 4 个必填字段；Base URL 可留空。")
        print("保存后重新运行脚本。配置文件已加入 Git 忽略规则，不会提交到仓库。")
        raise SystemExit(2)

    try:
        raw = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        fail(f"无法读取 JSON 配置文件 {config_path}: {exc}")
    if not isinstance(raw, dict):
        fail("配置文件顶层必须是 JSON 对象。")
    unknown = sorted(set(raw) - ALLOWED_KEYS)
    if unknown:
        fail("配置文件包含不支持的字段：" + ", ".join(unknown))
    missing = [key for key in REQUIRED if key not in raw]
    if missing:
        fail("配置文件缺少必填字段：" + ", ".join(missing))

    values = {}
    for key in REQUIRED + OPTIONAL_URLS:
        value = raw.get(key, "")
        if not isinstance(value, str):
            fail(f"{key} 必须是字符串。")
        value = value.strip()
        if key in REQUIRED and not value:
            fail(f"{key} 不能为空。")
        if any(ch in value for ch in "\r\n\x00"):
            fail(f"{key} 不能包含换行或空字符。")
        if key.endswith("_API_KEY"):
            if len(value) > 4096 or any(ch.isspace() for ch in value):
                fail(f"{key} 长度或格式不正确。")
        elif key.endswith("_MODEL"):
            if len(value) > 200 or not re.fullmatch(r"[A-Za-z0-9._:/+-]+", value):
                fail(f"{key} 模型 ID 格式不正确。")
        elif value:
            try:
                parsed = urlparse(value)
                valid_port = parsed.port is None or 1 <= parsed.port <= 65535
                valid_url = (
                    parsed.scheme == "https"
                    and bool(parsed.hostname)
                    and bool(parsed.netloc)
                    and not parsed.username
                    and not parsed.password
                    and not parsed.query
                    and not parsed.fragment
                    and valid_port
                    and not any(ch.isspace() for ch in value)
                )
            except ValueError:
                valid_url = False
            if not valid_url:
                fail(
                    f"{key} 必须是有效 HTTPS Base URL；不能包含账号密码、查询参数或片段。"
                    "请填写 API 根地址，例如 https://api.example.com/v1。"
                )
            value = value.rstrip("/")
        values[key] = value

    if values["AI_PROVIDER_MODEL"].casefold() == values["PRACTICE_REVIEWER_MODEL"].casefold():
        fail("Reviewer 模型必须与 Learning Agent 模型不同；未执行任何远程修改。")
    if values["AI_PROVIDER_API_KEY"] == values["PRACTICE_REVIEWER_API_KEY"]:
        print("提示：两个服务目前使用相同 API Key。建议使用独立 Reviewer 凭证隔离权限与额度。")
    values["KNOWVERSE_CONTENT_REF"] = "develop"
    return values


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
    major = int(match.group(1))
    if major != 3:
        fail(
            f"当前检测到 Supabase CLI v{major}；本脚本已按 CLI v3 参数验证。"
            "请先安装并确认 Supabase CLI v3，再重新运行。"
        )


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
        fail(f"当前 CLI 登录账号看不到 Staging 项目 {PROJECT_REF}。脚本不会改用其他项目。")


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

    parser = argparse.ArgumentParser(description="Configure KNOWVERSE Staging AI secrets from a local JSON file.")
    parser.add_argument(
        "--config",
        default=str(root / "config" / "staging-ai-secrets.json"),
        help="本机 JSON 配置文件路径（默认 config/staging-ai-secrets.json）",
    )
    args = parser.parse_args()
    config_path = Path(args.config).expanduser().resolve()
    template_path = root / "config" / "staging-ai-secrets.json.example"

    print("=" * 64)
    print("KNOWVERSE · Staging AI Secrets 配置")
    print(f"目标项目：{PROJECT_LABEL}")
    print(f"Project Ref：{PROJECT_REF}")
    print("安全边界：仅使用显式 Staging Project Ref，不读取默认 linked project。")
    print("=" * 64)

    # Parse and validate the local file before CLI installation, login, or any network operation.
    values = parse_config(config_path, template_path)
    print(f"本地配置文件校验通过：{config_path}")
    print("即将配置以下变量（只显示名称，不显示值）：")
    for name in values:
        print(f"  • {name}")

    binary = install_cli_if_needed()
    ensure_cli_v3(binary)
    ensure_project_access(binary)

    print(f"\n再次确认：目标必须是 {PROJECT_REF}（KNOWVERSE Staging），不是生产项目。")
    confirmation = input("请输入完整 Project Ref 以授权写入：").strip()
    if confirmation != PROJECT_REF:
        fail("Project Ref 确认不匹配，已取消；没有执行远程修改。", 2)

    env_path = write_env_file(values)
    try:
        result = run([
            binary, "secrets", "set", "--env-file", env_path,
            f"--remote={PROJECT_REF}", "--yes",
        ])
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
