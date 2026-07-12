"""Axiu-Plugin MihoyoBBSTools 单配置文件运行桥接

接收 --config 指定的 {qq}_n.yaml，在 MihoyoBBSTools 环境中执行 main.main()，
通过文件系统 IPC 桥接过码请求到 Node.js 侧。
"""

import argparse
import json
import os
import sys
import time
import traceback
import types
import uuid
from pathlib import Path


# ==================== 过码桥接 ====================

def _write_json(path: str, data: dict):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _install_captcha_bridge(captcha_dir: str, timeout: int):
    """替换 sys.modules['captcha'] 为文件 IPC 实现"""
    if not captcha_dir:
        return
    Path(captcha_dir).mkdir(parents=True, exist_ok=True)

    captcha_module = types.ModuleType("captcha")

    def _solve(kind: str, gt: str, challenge: str) -> dict | None:
        request_id = f"{int(time.time() * 1000)}-{uuid.uuid4().hex}"
        request_file = str(Path(captcha_dir) / f"{request_id}.request.json")
        response_file = str(Path(captcha_dir) / f"{request_id}.response.json")

        _write_json(request_file, {
            "id": request_id,
            "kind": kind,
            "gt": gt,
            "challenge": challenge,
        })

        deadline = time.time() + timeout
        while time.time() < deadline:
            if os.path.exists(response_file):
                try:
                    with open(response_file, "r", encoding="utf-8") as f:
                        response = json.load(f)
                except (json.JSONDecodeError, IOError):
                    time.sleep(0.5)
                    continue
                if not response.get("ok"):
                    return None
                validate = response.get("validate")
                if not validate:
                    return None
                return {
                    "challenge": response.get("challenge") or challenge,
                    "validate": validate,
                }
            time.sleep(0.5)
        return None

    captcha_module.game_captcha = lambda gt, challenge: _solve("game", gt, challenge)
    captcha_module.bbs_captcha = lambda gt, challenge: _solve("bbs", gt, challenge)
    sys.modules["captcha"] = captcha_module


# ==================== 主流程 ====================

def run(args: argparse.Namespace) -> int:
    module_dir = Path(args.module_dir).resolve()
    config_file = Path(args.config).resolve()

    # 设置 Python 路径和工作目录
    sys.path.insert(0, str(module_dir))
    os.chdir(str(module_dir))

    # 安装过码桥接（必须在 import MihoyoBBSTools 模块之前）
    _install_captcha_bridge(args.captcha_dir, args.captcha_timeout)

    # 导入 MihoyoBBSTools
    import config
    from main import main
    from error import CookieError, StokenError

    # 配置 MihoyoBBSTools 使用指定的配置文件
    config.config_Path = str(config_file)
    config.path = str(config_file.parent)
    config.config_prefix = ""
    config.serverless = True

    try:
        status_code, message = main()
        result = {"ok": status_code == 0, "statusCode": status_code, "message": message}
    except CookieError as e:
        result = {"ok": False, "statusCode": 1, "message": "Cookie 已失效", "error": str(e)}
    except StokenError as e:
        result = {"ok": False, "statusCode": 1, "message": "Stoken 已失效", "error": str(e)}
    except Exception as e:
        result = {
            "ok": False,
            "statusCode": 1,
            "message": "签到执行异常",
            "error": str(e),
            "traceback": traceback.format_exc(),
        }

    _write_json(args.result_file, result)
    return 0 if result.get("ok") else 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Axiu-Plugin MihoyoBBSTools sign-in runner")
    parser.add_argument("--config", required=True, help="MihoyoBBSTools 配置文件路径")
    parser.add_argument("--module-dir", required=True, help="MihoyoBBSTools 模块根目录")
    parser.add_argument("--captcha-dir", default="", help="过码 IPC 目录")
    parser.add_argument("--captcha-timeout", type=int, default=240, help="单次过码超时(秒)")
    parser.add_argument("--result-file", default="", help="结果 JSON 输出路径")
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(run(parse_args()))
