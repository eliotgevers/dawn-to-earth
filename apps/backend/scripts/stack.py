"""Operate one isolated, four-service Dawn to Earth workspace."""
import argparse
import os
from pathlib import Path
import secrets
import subprocess

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parents[1]


def init(directory):
    if directory.is_relative_to(ROOT):
        raise SystemExit("Choose a private directory outside the source checkout.")
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if any(directory.iterdir()):
        raise SystemExit("Choose an empty directory. Existing settings and credentials were left in place.")
    directory.chmod(0o700)
    os.umask(0o077)
    values = {
        "STACK_ID": "dte-" + secrets.token_hex(5),
        "WEB_PORT": "4331", "STACK_GRAFANA_PORT": "4332", "HTTPS_PORT": "4443",
        "PUBLIC_HOST": "localhost", "INGRESS_BIND": "127.0.0.1",
    }
    for key in ("DATABASE_PASSWORD", "GRAFANA_ADMIN_PASSWORD", "INFLUXDB_TOKEN", "INFLUXDB_PASSWORD"):
        values[key] = secrets.token_hex(32)
    (directory / ".env").write_text("".join(f"{k}={v}\n" for k, v in values.items()))
    password = secrets.token_urlsafe(30)
    (directory / "reviewer-password").write_text(password + "\n")
    hashed = subprocess.check_output(["openssl", "passwd", "-apr1", "-stdin"], input=password + "\n", text=True)
    reviewer_file = directory / "reviewers.htpasswd"
    reviewer_file.write_text("reviewer:" + hashed)
    # nginx workers read the hash. The enclosing host directory is owner-only.
    reviewer_file.chmod(0o644)
    subprocess.run([
        "openssl", "req", "-x509", "-newkey", "rsa:3072", "-nodes", "-days", "30",
        "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
        "-keyout", str(directory / "tls.key"), "-out", str(directory / "tls.crt"),
    ], check=True, stderr=subprocess.DEVNULL)
    print(f"Private settings created in {directory}. The TLS certificate is for local rehearsal.")


def operate(action, mode, directory):
    config = directory / ".env"
    if not config.is_file():
        raise SystemExit("Initialize this directory with stack.py init first.")
    # Initialization writes plain key=value lines; use the directory's secrets regardless of other local stacks.
    settings = dict(line.split("=", 1) for line in config.read_text().splitlines() if line and not line.startswith("#"))
    project = settings["STACK_ID"] + "-" + mode
    production = mode == "production"
    origin = ("https://" + settings["PUBLIC_HOST"] + (":" + settings["HTTPS_PORT"] if settings["HTTPS_PORT"] != "443" else "")
              if production else "http://localhost:" + settings["WEB_PORT"])
    grafana = origin + "/grafana" if production else "http://127.0.0.1:" + settings["STACK_GRAFANA_PORT"]
    env = dict(os.environ, **settings, STACK_DIR=str(directory), GRAFANA_PUBLIC_URL=grafana)
    compose = ["docker", "compose", "--project-name", project, "--env-file", str(config),
               "-f", str(BACKEND / "compose.local.yaml")]
    if production:
        compose += ["-f", str(BACKEND / "compose.production.yaml")]

    def run(*args):
        subprocess.run([*compose, *args], check=True, env=env)

    if action == "down":
        run("down")
        return
    run("config", "--quiet")
    if action == "config":
        return
    run("build", "web")
    run("up", "-d", "--wait", "postgres", "influxdb")
    run("run", "--rm", "--no-deps", "archive-job", "grants")
    run("run", "--rm", "--no-deps", "web", "bun", "db/seed/index.ts")
    run("up", "-d", "--wait", "grafana", "web")
    run("run", "--rm", "--no-deps", "archive-job", "sync")
    if production:
        run("up", "-d", "ingress")
    print(f"Workspace: {origin}\nGrafana: {grafana}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    commands.add_parser("init").add_argument("directory", type=Path)
    for command in ("up", "down", "config"):
        sub = commands.add_parser(command)
        sub.add_argument("mode", choices=("dev", "production"))
        sub.add_argument("directory", type=Path)
    args = parser.parse_args()
    directory = args.directory.expanduser().resolve()
    if args.action == "init":
        init(directory)
    else:
        operate(args.action, args.mode, directory)
