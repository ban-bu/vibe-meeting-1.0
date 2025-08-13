#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

if [ ! -x "./setup-and-start.sh" ]; then
  chmod +x ./setup-and-start.sh
fi

"$SHELL" -lc "./setup-and-start.sh"
read -p $'\n(已启动，按任意键关闭此窗口，不会影响服务运行)\n' -n 1 -s


