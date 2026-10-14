#!/bin/bash
# 平台一键自测：在临时目录里用「测试模式」把整套流程跑一遍，逐项检查，默认结束后清理
#
#   ./scripts/selftest.sh            跑完自动清理
#   ./scripts/selftest.sh --keep     保留环境，用浏览器体验（结束后 ./scripts/selftest.sh --clean）
#   ./scripts/selftest.sh --clean    清理 --keep 留下的环境
#
# 不需要外网上的代码仓库：应用用模板生成，「从 Git 安装」和自动发布用本机裸仓库模拟
# 注意：会占用容器名 yh-*、网络 yh-net、端口 18080。已经正式部署了平台的机器上不要跑（脚本会拒绝）。
set -uo pipefail

SRC_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${TMPDIR:-/tmp}/yh-selftest"
KEEP=""

pass=0; fail=0; results=""
ok() { pass=$((pass + 1)); results="$results\n  ✅ $1"; printf '\033[32m  ✅ %s\033[0m\n' "$1"; }
ng() { fail=$((fail + 1)); results="$results\n  ❌ $1 —— $2"; printf '\033[31m  ❌ %s —— %s\033[0m\n' "$1" "$2"; }
check() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$name"; else ng "$name" "${HINT:-见上方输出}"; fi; HINT=""; }
title() { printf '\n\033[36m━━ %s\033[0m\n' "$1"; }

clean() {
  if [ -x "$DIR/yh" ]; then (cd "$DIR" && echo destroy | ./yh destroy >/dev/null 2>&1); fi
  pkill -f "$DIR/yh agent" 2>/dev/null
  docker rm -f yhst-llm yhst-idp >/dev/null 2>&1
  # 兜底：只清自测创建的（compose 工作目录在 yh-selftest 下）
  local c
  for c in $(docker ps -aq --filter name=^yh-); do
    case "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$c" 2>/dev/null)" in
      *yh-selftest*) docker rm -f "$c" >/dev/null 2>&1;;
    esac
  done
  if ! docker ps -aq --filter name=^yh- | grep -q .; then
    docker volume rm yh-platform_mysql-data yh-platform_caddy-data >/dev/null 2>&1
    docker network rm yh-net >/dev/null 2>&1
    for c in $(docker network ls --format '{{.Name}}' | grep '^yh-app-'); do docker network rm "$c" >/dev/null 2>&1; done
  fi
  rm -rf "$DIR"
  echo "已清理自测环境"
}

case "${1:-}" in
  --keep) KEEP=1;;
  --clean) clean; exit 0;;
  "") ;;
  *) echo "用法：$0 [--keep | --clean]"; exit 1;;
esac

# ---- 前置检查 ----
if docker ps -a --format '{{.Names}}' | grep -q '^yh-'; then
  if [ -d "$DIR" ]; then echo "上次自测环境还在，先执行：$0 --clean"
  else echo "本机已有平台容器（yh-*）在运行，自测会冲突。请在未正式部署的机器上执行，或先在正式平台目录 yh destroy。"; fi
  exit 1
fi
docker info >/dev/null 2>&1 || { echo "Docker 没在运行（macOS：colima start）"; exit 1; }

title "准备：复制平台到 ${DIR}（不影响你的仓库）"
rm -rf "$DIR"; mkdir -p "$DIR"
rsync -a --exclude /apps --exclude /backups --exclude /yh.env --exclude /.git --exclude node_modules --exclude dist \
  --exclude /platform/console.env --exclude '/platform/caddy/apps/*.caddy' "$SRC_ROOT/" "$DIR/"
mkdir -p "$DIR/apps" "$DIR/backups"
cd "$DIR" || exit 1
YH="/bin/bash ./yh"   # 用 macOS 自带 bash 3.2 跑，和生产一致
nc() { sed $'s/\033\\[[0-9;]*m//g'; }

title "1. 初始化（测试模式）：平台 + 控制台"
# 飞书 / 企业微信的接口指到模拟平台（测试模式下 yh 把 YH_TEST_* 传给控制台）
cp yh.env.example yh.env
printf 'YH_TEST_FEISHU_API=http://yhst-idp:18998\nYH_TEST_FEISHU_ACCOUNTS=http://yhst-idp:18998\nYH_TEST_WECOM_API=http://yhst-idp:18998\n' >> yh.env
$YH init --test > init.log 2>&1
check "yh init --test" grep -q "以虎 One 已就绪" init.log
. ./yh.env
B="$PUBLIC_URL"
echo "  控制台：$B"
HINT="应为 200"; check "控制台首页" sh -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' $B/)\" = 200 ]"
HINT="应为 200"; check "开发中心 /dev/deploy" sh -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' $B/dev/deploy)\" = 200 ]"
HINT="应为 devLogin=true"; check "测试模式开了开发登录" sh -c "curl -s $B/api/auth/config | grep -q '\"devLogin\":true'"
J='Content-Type: application/json'
login() { curl -s -X POST "$B/api/auth/password" -H "$J" -d "{\"username\":\"$1\",\"password\":\"$2\"}" | jq -r '.data.token // empty'; }
T="$(login admin "$ADMIN_INITIAL_PASSWORD")"
HINT="用 yh.env 里的 ADMIN_INITIAL_PASSWORD 登录失败"; check "初始管理员账号密码登录" [ ${#T} -gt 50 ]
HINT="错误密码应被拒绝"; check "错误密码登录被拒" sh -c "[ -z \"\$(curl -s -X POST $B/api/auth/password -H '$J' -d '{\"username\":\"admin\",\"password\":\"wrong1234\"}' | jq -r '.data.token // empty')\" ]"
api() { local m="$1" p="$2"; shift 2; curl -s -X "$m" "$B$p" -H "Authorization: Bearer ${TOK:-$T}" -H "$J" "$@"; }

title "2. 用户与登录配置"
DEPT="$(api POST /api/org/departments -d '{"name":"研发部"}' | jq -r .data.id)"
api POST /api/org/users -d "{\"name\":\"自测·张三\",\"username\":\"zhangsan\",\"password\":\"abc12345\",\"deptIds\":[$DEPT]}" > /dev/null
api POST /api/org/users -d '{"name":"自测·李四","username":"lisi","password":"abc12345"}' > /dev/null
T_ZS="$(login zhangsan abc12345)"; T_LS="$(login lisi abc12345)"
HINT="新建用户登录失败"; check "管理员建部门、建用户，新用户能登录" sh -c "[ ${#T_ZS} -gt 50 ] && [ ${#T_LS} -gt 50 ]"
HINT="普通成员应 403"; check "普通成员进不了管理接口" sh -c "TOK=$T_ZS; curl -s $B/api/admin/overview -H \"Authorization: Bearer $T_ZS\" | grep -q '\"code\":1003'"
HINT="应拒绝关闭唯一的登录方式"; check "不能关掉唯一可用的登录方式" sh -c "curl -s -X PUT $B/api/admin/settings/login -H 'Authorization: Bearer $T' -H '$J' -d '{\"password\":false}' | grep -q '至少要保留'"
HINT="应拒绝"; check "不能取消自己的管理员身份" sh -c "curl -s -X PUT $B/api/org/users/1 -H 'Authorization: Bearer $T' -H '$J' -d '{\"roles\":[\"MEMBER\"]}' | grep -q '不能取消自己'"
LOGO='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4='
api PUT /api/admin/settings/general -d "{\"logo\":\"$LOGO\",\"workspaceSubtitle\":\"SELF TEST\"}" > /dev/null
HINT="公开配置里应带上 LOGO 和英文名"; check "设置 LOGO 和平台英文名" sh -c "curl -s $B/api/auth/config | jq -e '.data.logo == \"$LOGO\" and .data.workspaceSubtitle == \"SELF TEST\"'"
HINT="非图片应被拒绝"; check "LOGO 只接受图片" sh -c "curl -s -X PUT $B/api/admin/settings/general -H 'Authorization: Bearer $T' -H '$J' -d '{\"logo\":\"javascript:alert(1)\"}' | grep -q '图片'"
curl -s -X PUT "$B/api/me/profile" -H "Authorization: Bearer $T_ZS" -H "$J" -d '{"name":"自测·张三"}' > /dev/null
HINT="改名后 /api/me 应返回新名字"; check "个人中心修改自己的姓名" sh -c "curl -s -X PUT $B/api/me/profile -H 'Authorization: Bearer $T_LS' -H '$J' -d '{\"name\":\"自测·李四改\"}' | jq -e '.data.name == \"自测·李四改\"' && curl -s $B/api/me -H 'Authorization: Bearer $T_LS' | jq -e '.data.name == \"自测·李四改\"'"
HINT="空名字应被拒绝"; check "姓名不能为空" sh -c "curl -s -X PUT $B/api/me/profile -H 'Authorization: Bearer $T_LS' -H '$J' -d '{\"name\":\"  \"}' | grep -q '不能为空'"
PW="$($YH passwd lisi 2>&1 | nc | sed -n 's/.*新密码：\([A-Za-z0-9]*\).*/\1/p')"
HINT="yh passwd 后用新密码登录失败"; check "yh passwd 重设密码" sh -c "[ -n '$PW' ] && curl -s -X POST $B/api/auth/password -H '$J' -d '{\"username\":\"lisi\",\"password\":\"$PW\"}' | grep -q token"

title "2b. 飞书 / 企业微信登录（模拟平台）"
docker rm -f yhst-idp >/dev/null 2>&1
docker run -d --name yhst-idp --network yh-net -v "$DIR/scripts/mock-idp.mjs:/m.mjs:ro" node:20-alpine node /m.mjs >/dev/null 2>&1
sleep 3
HINT="没打开时应拒绝"; check "没打开飞书登录时不能用" sh -c "curl -s -X POST $B/api/auth/feishu -H '$J' -d '{\"code\":\"good\",\"redirectUri\":\"x\"}' | grep -q '未开启'"
api PUT /api/admin/settings/feishu -d '{"appId":"cli_test","appSecret":"fs_secret","bootstrapAdmins":["ou_zhang"]}' > /dev/null
api PUT /api/admin/settings/wecom -d '{"corpId":"ww_test","agentId":"1000002","secret":"wc_secret"}' > /dev/null
api PUT /api/admin/settings/login -d '{"feishu":true,"wecom":true}' > /dev/null
HINT="登录页配置里应有飞书和企业微信"; check "打开后登录页显示飞书、企业微信" sh -c "curl -s $B/api/auth/config | jq -e '.data.feishu.enabled and .data.wecom.enabled and .data.feishu.appId == \"cli_test\"'"
api POST /api/org/users -d '{"name":"自测·李四飞书","username":"lisifs","password":"abc12345","mobile":"13900000002"}' > /dev/null
fs() { curl -s -X POST "$B/api/auth/feishu" -H "$J" -d "{\"code\":\"$1\",\"redirectUri\":\"$B/auth/feishu/callback\"}"; }
wcx() { curl -s -X POST "$B/api/auth/wecom" -H "$J" -d "{\"code\":\"$1\"}"; }
HINT="无效授权码应被拒"; check "飞书：无效授权码被拒" sh -c "$(declare -f fs); B=$B J='$J'; fs bad | grep -q '授权码无效'"
FS_ID="$(fs good | jq -r .data.user.id)"
HINT="首次登录应建号，并按飞书管理员名单设为管理员"; check "飞书：首次登录自动建号、管理员名单生效" sh -c "$(declare -f fs); B=$B J='$J'; fs good | jq -e '.data.user.name == \"飞书·张三\" and (.data.user.roles | index(\"ADMIN\"))'"
HINT="手机号一致应对上已有用户"; check "飞书：手机号一致时对上已有账号" sh -c "$(declare -f fs); B=$B J='$J'; fs good2 | jq -e '.data.user.username == \"lisifs\"'"
HINT="同一个人换企业微信登录应是同一个账号"; check "企业微信：同一个人对上同一个账号" sh -c "$(declare -f wcx); B=$B J='$J'; [ \"\$(wcx good | jq -r .data.user.id)\" = '$FS_ID' ]"
HINT="非企业成员应被拒"; check "企业微信：非本企业成员被拒" sh -c "$(declare -f wcx); B=$B J='$J'; wcx outsider | grep -q '不是本企业的成员'"
api PUT /api/admin/settings/login -d '{"password":false}' > /dev/null
HINT="飞书、企业微信开着时应允许关掉密码登录"; check "有别的登录方式时可以关掉账号密码登录" sh -c "curl -s $B/api/auth/config | jq -e '.data.passwordLogin == false'"
api PUT /api/admin/settings/login -d '{"feishu":false}' > /dev/null
HINT="三个都关应被拒并恢复密码登录"; check "三种都关时拒绝，自动恢复账号密码登录" sh -c "curl -s -X PUT $B/api/admin/settings/login -H 'Authorization: Bearer $T' -H '$J' -d '{\"wecom\":false}' | grep -q '至少要保留' && curl -s $B/api/auth/config | jq -e '.data.passwordLogin == true'"
api PUT /api/admin/settings/login -d '{"feishu":false,"wecom":false,"password":true}' > /dev/null
docker rm -f yhst-idp >/dev/null 2>&1

title "3. 命令行上线应用（模板）"
HINT="改了 console/frontend/public/sdk 后要复制到 templates"; check "模板里的 SDK 与控制台提供下载的一致" sh -c "cmp -s console/frontend/public/sdk/yh-one.mjs templates/node/yh-one.mjs && cmp -s console/frontend/public/sdk/yh_one.py templates/python/yh_one.py"
$YH new demo-node --from node --name "Node 演示" > demo.log 2>&1 && $YH up demo-node >> demo.log 2>&1
check "Node 模板：yh new + yh up" grep -q "Node 演示 已上线" demo.log
$YH new demo-py --from python --name "Python 演示" >> demo.log 2>&1 && $YH up demo-py >> demo.log 2>&1
check "Python 模板：yh new + yh up" grep -q "Python 演示 已上线" demo.log
HINT="/apps/demo-node 应 308 到 /apps/demo-node/"; check "路径路由：补斜杠" sh -c "curl -s -o /dev/null -w '%{http_code} %{redirect_url}' '$B/apps/demo-node' | grep -q '^308 .*/apps/demo-node/\$'"
HINT="应返回友好提示"; check "未上线的应用给出提示页" sh -c "curl -s $B/apps/nope/ | grep -q '还没上线'"

title "4. 统一登录（从平台进入应用）"
sso() { # sso <应用入口> <令牌> → 打印登录后页面
  local loc="$1" tok="$2" hdr cookie q cb next
  hdr="$(curl -s -D - -o /dev/null "$loc")"
  loc="$(echo "$hdr" | grep -i '^location:' | tr -d '\r' | cut -d' ' -f2)"
  cookie="$(echo "$hdr" | grep -i '^set-cookie:' | tr -d '\r' | cut -d' ' -f2 | cut -d';' -f1)"
  q="$(python3 -c "import sys,json,urllib.parse as u; print(json.dumps(dict(u.parse_qsl(u.urlparse(sys.argv[1]).query))))" "$loc")"
  cb="$(curl -s -X POST "$B/api/sso/authorize" -H "Authorization: Bearer $tok" -H "$J" -d "$q" | jq -r .data.redirect)"
  next="$(curl -s -D - -o /dev/null -H "Cookie: $cookie" "$cb" | grep -i '^location:' | tr -d '\r' | cut -d' ' -f2)"
  case "$next" in /*) next="$B$next";; esac
  curl -s -H "Cookie: $cookie" "$next"
}
HINT="登录后页面应显示「自测·张三（研发部）」"; check "Node 模板应用统一登录" sh -c "$(declare -f sso); B=$B J='$J'; sso '$B/apps/demo-node/' '$T_ZS' | grep -q '自测·张三（研发部）'"
HINT="登录后页面应显示「自测·张三」"; check "Python 模板应用统一登录" sh -c "$(declare -f sso); B=$B J='$J'; sso '$B/apps/demo-py/' '$T_ZS' | grep -q '自测·张三'"
HINT="cookie 应限定在 /apps/demo-node"; check "会话 cookie 限定在应用路径" sh -c "curl -s -D - -o /dev/null '$B/apps/demo-node/' | grep -i '^set-cookie:' | grep -qi 'Path=/apps/demo-node;'"
# 可见范围：demo-node 只给研发部
DN="$(api GET /api/admin/apps | jq -r '.data[] | select(.code=="demo-node") | .id')"
api PUT "/api/admin/apps/$DN" -d "{\"visibility\":{\"deptIds\":[$DEPT]}}" >/dev/null
HINT="李四不在研发部，应看不到 demo-node"; check "可见范围：部门外的人看不到应用" sh -c "curl -s $B/api/apps -H 'Authorization: Bearer $T_LS' | jq -e '[.data[].code] | index(\"demo-node\") == null'"
HINT="李四应被拒绝"; check "可见范围：部门外的人登录应用被拒" sh -c "$(declare -f sso); B=$B J='$J'; ! sso '$B/apps/demo-node/' '$T_LS' | grep -q '你好'"
# 图标：清单里写仓库里的图片文件 → 登记成图片；管理员换过的图标发布时不被覆盖，可以恢复
DN_M="$(ls "$DIR"/apps/demo-node/yh-app.json "$DIR"/apps/demo-node/src/yh-app.json 2>/dev/null | head -1)"
printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1c1917"/></svg>' > "$(dirname "$DN_M")/icon.svg"
jq '.icon = "icon.svg"' "$DN_M" > "$DN_M.tmp" && mv "$DN_M.tmp" "$DN_M"
dn_icon() { api GET /api/admin/apps | jq -r '.data[] | select(.code=="demo-node") | "\(.iconCustom) \(.icon)"' | cut -c1-40; }
$YH up demo-node >> demo.log 2>&1; V="$(dn_icon)"
HINT="清单 icon 写 icon.svg 时应登记成 SVG 图片，实际：$V"; check "图标：清单里写仓库里的图片文件" sh -c "case '$V' in 'false data:image/svg+xml;base64,'*) exit 0;; *) exit 1;; esac"
api PUT "/api/admin/apps/$DN" -d '{"icon":"🎯","iconColor":"#d2521e"}' >/dev/null
$YH up demo-node >> demo.log 2>&1; V="$(dn_icon)"
HINT="管理员换的图标在重新发布后应保留，实际：$V"; check "图标：管理员换过的图标发布时不被覆盖" sh -c "[ '$V' = 'true 🎯' ]"
api PUT "/api/admin/apps/$DN" -d '{"iconReset":true}' >/dev/null; V="$(dn_icon)"
HINT="恢复后应回到清单里的 SVG，实际：$V"; check "图标：恢复为代码里的图标" sh -c "case '$V' in 'false data:image/svg+xml;base64,'*) exit 0;; *) exit 1;; esac"

# 标准 OIDC：现成系统（GitLab、Grafana 等）不改代码接入。这里用 curl 模拟一个标准客户端走完授权码 + PKCE
DISCO="$(curl -s "$B/.well-known/openid-configuration")"
HINT="issuer 应等于访问地址，端点挂在它下面"; check "OIDC 发现文档" test "$(echo "$DISCO" | jq -r '.issuer + " " + .token_endpoint')" = "$B $B/api/oidc/token"
HINT="jwks 里应有一把 RS256 公钥"; check "OIDC 公钥 jwks" test "$(curl -s "$B/api/oidc/jwks" | jq -r '.keys[0].kty + "/" + .keys[0].alg')" = "RSA/RS256"
OIDC_SECRET="$(api POST /api/admin/apps -d "{\"code\":\"oidc-test\",\"name\":\"自测·OIDC\",\"type\":\"SSO\",\"url\":\"$B/oidc-test/\",\"redirectUris\":[\"$B/oidc-test/cb\"]}" | jq -r '.data.clientSecret // empty')"
OIDC_VERIFIER="selftest-pkce-verifier-0123456789-abcdefghijklmnop"
OIDC_CHALLENGE="$(printf %s "$OIDC_VERIFIER" | openssl dgst -sha256 -binary | base64 | tr '+/' '-_' | tr -d '=')"
oidc_authorize() { # oidc_authorize <令牌> [额外 JSON 字段] → 授权后跳转地址
  curl -s -X POST "$B/api/sso/authorize" -H "Authorization: Bearer $1" -H "$J" -d "{\"client_id\":\"oidc-test\",\"redirect_uri\":\"$B/oidc-test/cb\",\"state\":\"st1\",\"response_type\":\"code\",\"scope\":\"openid profile groups\",\"nonce\":\"nc1\",\"code_challenge\":\"$OIDC_CHALLENGE\",\"code_challenge_method\":\"S256\"${2:+,$2}}" | jq -r '.data.redirect // empty'
}
qparam() { python3 -c "import sys,urllib.parse as u; print(dict(u.parse_qsl(u.urlparse(sys.argv[1]).query)).get(sys.argv[2],''))" "$1" "$2"; }
OIDC_CODE="$(qparam "$(oidc_authorize "$T_ZS")" code)"
oidc_token() { curl -s -X POST "$B/api/oidc/token" -u "oidc-test:$OIDC_SECRET" -d grant_type=authorization_code -d "code=$1" -d "redirect_uri=$B/oidc-test/cb" -d "code_verifier=$OIDC_VERIFIER"; }
OIDC_TOKENS="$(oidc_token "$OIDC_CODE")"
IDT_CLAIMS="$(echo "$OIDC_TOKENS" | jq -r '.id_token // empty' | cut -d. -f2 | python3 -c "import sys,base64; s=sys.stdin.read().strip(); print(base64.urlsafe_b64decode(s + '=' * (-len(s) % 4)).decode())" 2>/dev/null)"
HINT="id_token 应带 iss / aud / nonce / 姓名 / 部门"; check "OIDC 授权码 + PKCE 换到 id_token" sh -c "echo '$IDT_CLAIMS' | jq -e '.iss == \"$B\" and .aud == \"oidc-test\" and .nonce == \"nc1\" and .name == \"自测·张三\" and (.groups | index(\"研发部\"))'"
HINT="第二次用同一个 code 应 invalid_grant"; check "OIDC 授权码只能用一次" test "$(oidc_token "$OIDC_CODE" | jq -r .error)" = "invalid_grant"
HINT="userinfo 应返回张三"; check "OIDC userinfo" test "$(curl -s "$B/api/oidc/userinfo" -H "Authorization: Bearer $(echo "$OIDC_TOKENS" | jq -r .access_token)" | jq -r .name)" = "自测·张三"
HINT="不同意应跳回应用并带 error=access_denied"; check "OIDC 用户拒绝授权" test "$(qparam "$(oidc_authorize "$T_ZS" '"deny":true')" error)" = "access_denied"

title "5. AI 工具聚合（MCP 网关）"
KEY="$(curl -s -X POST $B/api/me/api-keys -H "Authorization: Bearer $T_ZS" -H "$J" -d '{"name":"自测"}' | jq -r .data.key)"
mcp() { curl -s -X POST "$B/api/mcp" -H "Authorization: Bearer $1" -H "$J" -H 'Accept: application/json, text/event-stream' -d "$2"; }
HINT="张三的工具列表里应有 demo-node__whoami"; check "应用的 MCP 工具并入平台 MCP" sh -c "$(declare -f mcp); B=$B J='$J'; mcp '$KEY' '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}' | jq -e '[.result.tools[].name] | index(\"demo-node__whoami\")'"
HINT="应用收到的应是张三的身份"; check "调用应用工具时带上用户身份" sh -c "$(declare -f mcp); B=$B J='$J'; mcp '$KEY' '{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"demo-node__whoami\",\"arguments\":{}}}' | grep -q '自测·张三'"
KEY_LS="$(curl -s -X POST $B/api/me/api-keys -H "Authorization: Bearer $T_LS" -H "$J" -d '{"name":"自测"}' | jq -r .data.key)"
HINT="李四看不到 demo-node，也不应有它的工具"; check "工具也按可见范围收敛" sh -c "$(declare -f mcp); B=$B J='$J'; mcp '$KEY_LS' '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}' | jq -e '[.result.tools[].name] | index(\"demo-node__whoami\") == null'"

# Skill 中心：张三的 Agent 经 MCP 上传 Skill、分享给李四；管理员没被分享也看不到；更新检查；不可信上传被拦
skillcall() { mcp "$1" "{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"tools/call\",\"params\":{\"name\":\"$2\",\"arguments\":$3}}" | jq -c '.result.content[0].text | fromjson? // .'; }
LS_UID="$(TOK=$T_LS api GET /api/me | jq -r .data.id)"
KEY_ADM="$(api POST /api/me/api-keys -d '{"name":"自测"}' | jq -r .data.key)"
SKILL_MD='---\nname: selftest-weekly\ndescription: 自测用的周报 Skill\nversion: 1.0.0\n---\n# 周报\n'
SK_PUB="$(skillcall "$KEY" publish_skill "{\"files\":[{\"path\":\"SKILL.md\",\"content\":\"$SKILL_MD\"},{\"path\":\"scripts/run.sh\",\"content\":\"echo hi\"}],\"scope\":\"SHARED\",\"userIds\":[$LS_UID]}")"
HINT="应立即生效，版本取 SKILL.md 的 version"; check "Skill：Agent 经 MCP 上传并分享" sh -c "echo '$SK_PUB' | jq -e '.status == \"APPROVED\" and .version == \"1.0.0\"'"
HINT="李四应能列出并取到 2 个文件"; check "Skill：被分享的人能取用" sh -c "$(declare -f mcp skillcall); B=$B J='$J'; skillcall '$KEY_LS' get_skill '{\"skill\":\"selftest-weekly\"}' | jq -e '(.files | length) == 2 and .files[0].path == \"SKILL.md\"'"
HINT="管理员没被分享，list_skills 里不该有"; check "Skill：没被分享的人看不到" sh -c "$(declare -f mcp skillcall); B=$B J='$J'; skillcall '$KEY_ADM' list_skills '{}' | jq -e 'map(.name) | index(\"selftest-weekly\") == null'"
SK_DIGEST="$(skillcall "$KEY_LS" get_skill '{"skill":"selftest-weekly"}' | jq -r .digest)"
HINT="同一份应 up_to_date"; check "Skill：更新检查（已是最新）" sh -c "$(declare -f mcp skillcall); B=$B J='$J'; skillcall '$KEY_LS' check_skill_updates '{\"installed\":[{\"name\":\"selftest-weekly\",\"digest\":\"$SK_DIGEST\"}]}' | jq -e '.[0].status == \"up_to_date\"'"
skillcall "$KEY" publish_skill "{\"files\":[{\"path\":\"SKILL.md\",\"content\":\"${SKILL_MD/1.0.0/1.1.0}\"}],\"scope\":\"SHARED\",\"userIds\":[$LS_UID]}" >/dev/null
HINT="发了新版本后旧指纹应 update_available"; check "Skill：更新检查（有新版本）" sh -c "$(declare -f mcp skillcall); B=$B J='$J'; skillcall '$KEY_LS' check_skill_updates '{\"installed\":[{\"name\":\"selftest-weekly\",\"digest\":\"$SK_DIGEST\"}]}' | jq -e '.[0].status == \"update_available\" and .[0].platformVersion == \"1.1.0\"'"
HINT="../ 路径应被拒"; check "Skill：路径穿越被拦" sh -c "$(declare -f mcp skillcall); B=$B J='$J'; skillcall '$KEY' publish_skill '{\"files\":[{\"path\":\"SKILL.md\",\"content\":\"x\"},{\"path\":\"../evil\",\"content\":\"x\"}],\"scope\":\"PRIVATE\"}' | grep -q '路径不合法'"
HINT="市场 Skill 分类里应有它，工作台里不该有"; check "Skill：在市场里、不在工作台里" sh -c "curl -s '$B/api/market/apps?kind=SKILL' -H 'Authorization: Bearer $T_LS' | jq -e '.data.apps | map(.kind) | index(\"SKILL\")' && curl -s $B/api/apps -H 'Authorization: Bearer $T_LS' | jq -e '.data | map(.kind) | index(\"SKILL\") == null'"

# 用 Agent 发布：普通同事（张三）经 MCP 发轻应用分享给李四；不能发代码应用；code 冲突给建议
HINT="张三不是开发者：能发轻应用、不能发代码应用"; check "Agent 发布：我能发什么" sh -c "$(declare -f mcp skillcall); B=$B J='$J'; skillcall '$KEY' list_my_published '{}' | jq -e '.canPublish.LITE == true and .canPublish.HOSTED == false'"
HINT="保留字应不可用并给建议"; check "Agent 发布：code 冲突给替代建议" sh -c "$(declare -f mcp skillcall); B=$B J='$J'; skillcall '$KEY' check_app_code '{\"code\":\"admin\"}' | jq -e '.available == false and (.suggestions | length) > 0'"
AP_LITE="$(skillcall "$KEY" publish_app "{\"kind\":\"LITE\",\"name\":\"自测·报名\",\"html\":\"<!doctype html><h1>报名</h1>\",\"scope\":\"SHARED\",\"userIds\":[$LS_UID]}")"
HINT="应立即生效并返回 /lite/<id> 地址"; check "Agent 发布：经 MCP 发轻应用" sh -c "echo '$AP_LITE' | jq -e '.result == \"已生效\" and (.url | test(\"/lite/[0-9]+$\"))'"
HINT="李四应在市场里看到它"; check "Agent 发布：分享的人能看到" sh -c "curl -s '$B/api/market/apps?kind=LITE' -H 'Authorization: Bearer $T_LS' | jq -e --argjson id $(echo "$AP_LITE" | jq .id) '.data.apps | map(.id) | index(\$id)'"
HINT="应被拒并说明要开发者"; check "Agent 发布：普通同事发不了代码应用" sh -c "$(declare -f mcp skillcall); B=$B J='$J'; skillcall '$KEY' publish_app '{\"kind\":\"HOSTED\",\"name\":\"x\",\"code\":\"st-hosted-x\",\"git\":\"https://example.com/x.git\",\"scope\":\"PRIVATE\"}' | grep -q '开发者'"

# 千人千面首页：张三让 Agent 改自己的首页；数据卡片以本人身份取数；写操作工具不能当数据来源；李四不受影响
HINT="没改过应是默认首页（问候、开始配置、AI 助手、我的应用）"; check "首页：默认模板" sh -c "$(declare -f mcp skillcall); B=$B J='$J'; skillcall '$KEY' get_my_home '{}' | jq -e '.custom == false and ([.cards[].type] | join(\",\")) == \"greeting,setup,assistant,apps\"'"
HOME_SET="$(skillcall "$KEY" set_my_home '{"cards":[{"type":"greeting"},{"id":"myapps","type":"data","title":"我的应用","tool":"list_my_apps","view":"table"},{"type":"text","title":"提醒","text":"周五交周报"}]}')"
HINT="应保存 3 张卡片，来源 agent"; check "首页：Agent 经 MCP 改首页" sh -c "echo '$HOME_SET' | jq -e '.custom == true and (.cards | length) == 3 and .source == \"agent\"'"
HINT="数据卡片应以张三身份返回他的应用"; check "首页：数据卡片取数" sh -c "curl -s $B/api/me/home/cards/myapps/data -H 'Authorization: Bearer $T_ZS' | jq -e '.data.result | type == \"array\"'"
HINT="写操作工具应被拒"; check "首页：数据卡片不能用写操作工具" sh -c "$(declare -f mcp skillcall); B=$B J='$J'; skillcall '$KEY' set_my_home '{\"cards\":[{\"type\":\"data\",\"tool\":\"publish_app\"}]}' | grep -q '只读工具'"
HINT="李四应还是默认首页，也取不到张三的卡片"; check "首页：每人一份，互不可见" sh -c "curl -s $B/api/me/home -H 'Authorization: Bearer $T_LS' | jq -e '.data.custom == false' && curl -s $B/api/me/home/cards/myapps/data -H 'Authorization: Bearer $T_LS' | jq -e '.code != 0'"
HINT="reset 后应回到默认"; check "首页：恢复默认" sh -c "$(declare -f mcp skillcall); B=$B J='$J'; skillcall '$KEY' set_my_home '{\"reset\":true}' | jq -e '.custom == false'"

title "5b. 应用市场：AI 助手、轻应用、外部应用、审核、授权、隔离"
# 假模型跑在平台网络里的临时容器（控制台按容器名访问，和宿主机的 Docker 环境无关）
docker rm -f yhst-llm >/dev/null 2>&1
docker run -d --name yhst-llm --network yh-net -v "$DIR/scripts/mock-llm.mjs:/m.mjs:ro" node:20-alpine node /m.mjs >/dev/null 2>&1
sleep 3
api POST /api/admin/llm-configs -d '{"name":"自测假模型","provider":"OPENAI_COMPAT","baseUrl":"http://yhst-llm:18999/v1","model":"mock","apiKey":"mock","extra":{"requireTool":false}}' > /dev/null
llm_last() { docker logs yhst-llm 2>/dev/null | tail -1; }
chat() { curl -sN -X POST "$B/api/assistant/chat" -H "Authorization: Bearer $1" -H "$J" -d "$2" --max-time 60; }
HINT="见 docker logs yhst-llm"; check "默认助手能用假模型对话" sh -c "$(declare -f chat); B=$B J='$J'; chat '$T_ZS' '{\"message\":\"你好\"}' | grep -q 'MOCK 回答'"

AG="$(TOK=$T_ZS api POST /api/studio/apps -d '{"kind":"AGENT","name":"自测助手","description":"自测用的 AI 助手"}' | jq -r .data.id)"
TOK=$T_ZS api PUT "/api/studio/apps/$AG/draft" -d '{"payload":{"prompt":"你只回答身份问题","tools":["get_my_profile"],"starters":["我是谁"]}}' > /dev/null
HINT="员工的 AI 助手仅自己用应直接生效"; check "AI 助手：员工创建，仅自己用直接生效" sh -c "TOK=$T_ZS; curl -s -X POST $B/api/studio/apps/$AG/submit -H 'Authorization: Bearer $T_ZS' -H '$J' -d '{\"scope\":\"PRIVATE\"}' | jq -e '.data.status == \"APPROVED\"'"
HINT="李四还看不到"; check "AI 助手：没分享时别人用不了" sh -c "$(declare -f chat); B=$B J='$J'; chat '$T_LS' '{\"message\":\"x\",\"appId\":$AG}' | grep -q '你不能使用'"
LS_ID="$(TOK=$T_LS api GET /api/me | jq -r .data.id)"
TOK=$T_ZS api POST "/api/studio/apps/$AG/submit" -d "{\"scope\":\"SHARED\",\"visibility\":{\"userIds\":[$LS_ID]}}" > /dev/null
chat "$T_LS" "{\"message\":\"我是谁\",\"appId\":$AG}" > /dev/null
HINT="应只带发布者选的工具，且带发布者设定"; check "AI 助手：分享后同事能用，只带选中的工具" sh -c "docker logs yhst-llm 2>/dev/null | grep '\"hasAgent\":true' | tail -1 | jq -e '.tools == [\"get_my_profile\"]'"
TOK=$T_ZS api POST "/api/studio/apps/$AG/submit" -d '{"scope":"MARKET","changelog":"上架"}' > /dev/null
VID="$(api GET /api/admin/review | jq -r '.data[0].id')"
HINT="上架应进入待审核"; check "上架市场要审核（审核台里有它）" [ "$(api GET /api/admin/review | jq -r '.data[0].app.id')" = "$AG" ]
api POST "/api/admin/review/$VID/approve" -d '{}' > /dev/null
HINT="审核通过后市场里应能看到"; check "审核通过后上架" sh -c "curl -s $B/api/market/apps -H 'Authorization: Bearer $T' | jq -e '[.data.apps[] | select(.id==$AG and .scope==\"MARKET\")] | length == 1'"
TOK=$T_LS api POST "/api/market/apps/$AG/rate" -d '{"stars":4,"comment":"自测"}' > /dev/null
HINT="应有评分"; check "评分" sh -c "curl -s $B/api/market/apps/$AG -H 'Authorization: Bearer $T' | jq -e '.data.rating == 4'"
TOK=$T_LS api POST "/api/market/apps/$AG/report" -d '{"reason":"自测举报"}' > /dev/null
RID="$(api GET /api/admin/reports | jq -r '.data[0].id')"; api POST "/api/admin/reports/$RID/resolve" -d '{"action":"delist","note":"自测下架"}' > /dev/null
HINT="下架后市场里不应再有"; check "举报 → 下架" sh -c "! curl -s $B/api/market/apps -H 'Authorization: Bearer $T_LS' | jq -e '.data.apps[] | select(.id==$AG)' >/dev/null"

LT="$(TOK=$T_ZS api POST /api/studio/apps -d '{"kind":"LITE","name":"自测轻应用","description":"自测"}' | jq -r .data.id)"
curl -sN -X POST "$B/api/studio/apps/$LT/generate" -H "Authorization: Bearer $T_ZS" -H "$J" -d '{"message":"做一个自测页面"}' --max-time 60 > gen.log
HINT="见 gen.log"; check "轻应用：对话生成页面，自动推断出要用 AI" sh -c "grep -q '\"type\":\"result\",\"ok\":true' gen.log && grep -q '\"ai\":true' gen.log"
TOK=$T_ZS api POST "/api/studio/apps/$LT/submit" -d "{\"scope\":\"SHARED\",\"visibility\":{\"userIds\":[$LS_ID]}}" > /dev/null
HINT="别人第一次打开要用 AI 的轻应用应先授权"; check "轻应用：同事第一次打开要先授权（且拿不到页面代码）" sh -c "curl -s $B/api/lite/$LT -H 'Authorization: Bearer $T_LS' | jq -e '.data.needGrant.ai == true and .data.html == null'"
TOK=$T_LS api POST "/api/lite/$LT/grant" > /dev/null
HINT="授权后应能调 AI"; check "轻应用：授权后能调 AI" sh -c "curl -s -X POST $B/api/lite/$LT/ai -H 'Authorization: Bearer $T_LS' -H '$J' -d '{\"prompt\":\"hi\"}' | jq -e '.data.text | test(\"MOCK\")'"
TOK=$T_ZS api POST "/api/lite/$LT/db/items" -d '{"data":{"n":1},"shared":true}' > /dev/null
TOK=$T_ZS api POST "/api/lite/$LT/db/items" -d '{"data":{"n":2}}' > /dev/null
HINT="李四应只看到共享的 1 条"; check "轻应用数据：共享的大家看得到，私有的只有自己" sh -c "curl -s $B/api/lite/$LT/db/items -H 'Authorization: Bearer $T_LS' | jq -e '.data.total == 1 and .data.list[0].data.n == 1'"
RID="$(TOK=$T_LS api GET "/api/lite/$LT/db/items" | jq -r '.data.list[0].id')"
HINT="不能改别人的记录"; check "轻应用数据：不能改别人创建的记录" sh -c "curl -s -X PUT $B/api/lite/$LT/db/items/$RID -H 'Authorization: Bearer $T_LS' -H '$J' -d '{\"data\":{\"n\":9}}' | grep -q '只能修改自己'"
HINT="没申请的工具应被拒"; check "轻应用：没申请的工具不能调" sh -c "curl -s -X POST $B/api/lite/$LT/tools/search_users -H 'Authorization: Bearer $T_LS' -H '$J' -d '{}' | grep -q '没有申请'"

XE="$(TOK=$T_ZS api POST /api/studio/apps -d '{"kind":"EXTERNAL","name":"自测外部应用","code":"st-ext","description":"自测"}' | jq -r .data.id)"
TOK=$T_ZS api PUT "/api/studio/apps/$XE/draft" -d "{\"payload\":{\"url\":\"$B/apps/demo-node/\",\"redirectUris\":[\"$B/apps/demo-node/sso/callback\"]},\"permissions\":{\"scopes\":[\"org\"]}}" > /dev/null
HINT="外部应用分享要审核"; check "外部应用：分享要审核" sh -c "curl -s -X POST $B/api/studio/apps/$XE/submit -H 'Authorization: Bearer $T_ZS' -H '$J' -d '{\"scope\":\"MARKET\"}' | jq -e '.data.status == \"PENDING\"'"
api POST "/api/admin/review/$(api GET /api/admin/review | jq -r '.data[0].id')/approve" -d '{}' > /dev/null
SEC="$(TOK=$T_ZS api POST /api/studio/apps/$XE/secret | jq -r .data.clientSecret)"
HINT="应需要用户确认"; check "外部应用：第一次登录要用户确认授权" sh -c "curl -s '$B/api/sso/consent?client_id=st-ext' -H 'Authorization: Bearer $T_LS' | jq -e '.data.needConsent.items | length == 2'"
CODE="$(TOK=$T_LS api POST /api/sso/authorize -d "{\"client_id\":\"st-ext\",\"redirect_uri\":\"$B/apps/demo-node/sso/callback\",\"consent\":true}" | jq -r .data.redirect | sed 's/.*code=\([^&]*\).*/\1/')"
HINT="没申请 contact 就不应给手机号"; check "外部应用：只拿到授权范围内的用户信息" sh -c "curl -s -X POST $B/api/sso/token -u 'st-ext:$SEC' -H '$J' -d '{\"code\":\"$CODE\",\"redirect_uri\":\"$B/apps/demo-node/sso/callback\"}' | jq -e '.data.user | has(\"mobile\") | not'"
HINT="普通员工不能建代码应用"; check "代码应用：只有管理员 / 开发者能提交" sh -c "curl -s -X POST $B/api/studio/apps -H 'Authorization: Bearer $T_LS' -H '$J' -d '{\"kind\":\"HOSTED\",\"name\":\"x\",\"code\":\"st-x\"}' | grep -q '只有管理员和开发者'"
HINT="应用之间不应互通"; check "网络隔离：应用之间访问不到，能访问控制台" sh -c "docker exec yh-demo-node wget -qO- -T 3 http://yh-console:3105/health >/dev/null && ! docker exec yh-demo-node wget -qO- -T 3 http://yh-demo-py:3000/health >/dev/null 2>&1"
docker rm -f yhst-llm >/dev/null 2>&1

title "6. 控制台插拔应用（yh agent 执行）"
BARE="$DIR/gitee/rel-demo.git"; WT="$DIR/gitee/rel-demo"
mkdir -p "$WT" && git init -q --bare -b main "$BARE"
cp -R "$DIR/templates/node/." "$WT/"
( cd "$WT" && for f in $(grep -rl "__CODE__\|__NAME__" .); do sed -e 's/__CODE__/rel-demo/g' -e 's/__NAME__/发布演示/g' "$f" > "$f.tmp" && mv "$f.tmp" "$f"; done
  sed 's/ok: true/ok: true, v: "v1"/' server.js > s.tmp && mv s.tmp server.js
  git init -q -b main && git add -A && git -c user.name=自测 -c user.email=t@t commit -qm "v1" && git push -q "$BARE" main:release main:main )
push_ver() { # push_ver <版本> [坏]
  ( cd "$WT" && grep -v '^process.exit(1)$' server.js | sed -E "s/v: \"[^\"]*\"/v: \"$1\"/" > s.tmp && mv s.tmp server.js
    [ -n "${2:-}" ] && printf 'process.exit(1)\n' >> server.js
    git -c user.name=自测 -c user.email=t@t commit -qam "$1${2:+（坏版本）}" && git push -q "$BARE" main:release )
}
ver() { curl -s "$B/apps/rel-demo/health" | jq -r .v; }
op() { # op <kind> <code> [params json] → 等到结束，打印状态
  local id st i p="${3:-}"
  [ -n "$p" ] || p='{}'
  id="$(api POST /api/admin/platform/ops -d "{\"kind\":\"$1\",\"appCode\":\"$2\",\"params\":$p}" | jq -r .data.id)"
  for i in $(seq 1 150); do
    st="$(api GET "/api/admin/platform/ops/$id" | jq -r .data.status)"
    case "$st" in SUCCESS|FAILED) break;; esac; sleep 2
  done
  echo "$st"
}
WATCH_INTERVAL=3600 nohup $YH agent > agent.log 2>&1 &
sleep 3
HINT="见 agent.log"; check "从 Git 安装（控制台下发，agent 执行）" [ "$(op INSTALL rel-demo "{\"git\":\"file://$BARE\"}")" = SUCCESS ]
HINT="应为 v1"; check "安装后应用可访问（跟踪 release 分支）" [ "$(ver)" = v1 ]
sleep 35
HINT="控制台里应有 rel-demo 的运行状态"; check "agent 上报运行状态" sh -c "curl -s $B/api/admin/apps -H 'Authorization: Bearer $T' | jq -e '.data[] | select(.code==\"rel-demo\") | .runtime.health == \"ok\"'"
push_ver v2
HINT="应为 v2"; check "控制台「发布」拉最新代码上线" sh -c "[ \"$(op DEPLOY rel-demo)\" = SUCCESS ] && [ \"\$(curl -s $B/apps/rel-demo/health | jq -r .v)\" = v2 ]"
HINT="停用后应 404"; check "控制台「停用」" sh -c "[ \"$(op STOP rel-demo)\" = SUCCESS ] && [ \"\$(curl -s -o /dev/null -w '%{http_code}' $B/apps/rel-demo/health)\" = 404 ]"
HINT="启动后应为 v2"; check "控制台「启动」" sh -c "[ \"$(op START rel-demo)\" = SUCCESS ] && [ \"\$(curl -s $B/apps/rel-demo/health | jq -r .v)\" = v2 ]"
HINT="应成功"; check "控制台「重启」" [ "$(op RESTART rel-demo)" = SUCCESS ]
LOGS_ID="$(api POST /api/admin/platform/ops -d '{"kind":"LOGS","appCode":"rel-demo","params":{"lines":20}}' | jq -r .data.id)"; sleep 8
HINT="日志里应有 listening"; check "控制台「日志」" sh -c "curl -s $B/api/admin/platform/ops/$LOGS_ID -H 'Authorization: Bearer $T' | jq -r .data.log | grep -q listening"

title "7. 自动发布：推 release → 自动更新 → 坏版本自动回滚"
push_ver v3; $YH watch --no-self > watch1.log 2>&1
HINT="见 watch1.log"; check "推 v3 → 自动发布" [ "$(ver)" = v3 ]
push_ver v4 bad; $YH watch --no-self > watch2.log 2>&1
HINT="见 watch2.log"; check "推坏版本 v4 → 健康检查不过 → 回滚，仍是 v3" [ "$(ver)" = v3 ]
$YH watch --no-self > watch3.log 2>&1
HINT="同一坏提交不应反复重试"; check "坏提交不反复重试" sh -c "! grep -q 发布 watch3.log"
push_ver v5; $YH watch --no-self > watch4.log 2>&1
HINT="见 watch4.log"; check "修复后推 v5 → 自动发布" [ "$(ver)" = v5 ]
HINT="控制台发布记录应有 成功 / 回滚"; check "发布记录同步到控制台" sh -c "curl -s '$B/api/admin/platform/deploys?appCode=rel-demo' -H 'Authorization: Bearer $T' | jq -e '[.data[].result] | (index(\"回滚\") != null) and (index(\"成功\") != null)'"
HINT="见 backups/notify.log"; check "发布通知（测试模式只写日志）" sh -c "grep -q '发布演示 已发布' backups/notify.log && grep -q '发布演示 发布失败' backups/notify.log"
HINT="应只留最近 3 个版本"; check "旧镜像自动清理" sh -c "[ \$(docker images yh-app-rel-demo --format '{{.Tag}}' | grep -vc latest) -le 3 ]"
HINT="发布结束后 .deploy.lock 应已删除"; check "发布结束后释放发布锁" [ ! -d .deploy.lock ]
rm -rf .deploy.lock; mkdir .deploy.lock && echo $$ > .deploy.lock/pid; push_ver v6; $YH watch --no-self > watch5.log 2>&1; rm -rf .deploy.lock
HINT="有人在发布时应跳过"; check "发布锁：并发时不重复发布" [ "$(ver)" = v5 ]

title "8. 移除应用"
HINT="见控制台操作日志"; check "控制台「移除」" [ "$(op REMOVE rel-demo)" = SUCCESS ]
HINT="应已备份并从控制台删除"; check "移除前备份、控制台里不再有它" sh -c "ls -d backups/removed/rel-demo-* && ! curl -s $B/api/admin/apps -H 'Authorization: Bearer $T' | grep -q '\"code\":\"rel-demo\"'"
pkill -f "$DIR/yh agent" 2>/dev/null

title "9. 运维命令"
$YH status > status.log 2>&1; nc < status.log | sed 's/^/  /'
HINT="有应用不健康"; check "yh status 全部正常" sh -c "[ \$(grep -c 正常 status.log) -ge 3 ]"
$YH backup > backup.log 2>&1
check "yh backup（控制台库 + 数据目录）" sh -c "ls backups/*/yh_console.sql.gz && ls backups/*/files.tar.gz"
$YH down demo-py > down.log 2>&1
HINT="停用后应 404"; check "yh down 停用" sh -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' $B/apps/demo-py/health)\" = 404 ]"
$YH up demo-py > down.log 2>&1
HINT="重新上线后应 200"; check "yh up 恢复" sh -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' $B/apps/demo-py/health)\" = 200 ]"

title "10. 模拟断电：停掉全部容器 → yh start"
docker stop $(docker ps -q --filter name=^yh-) >/dev/null 2>&1
$YH start > start.log 2>&1; sleep 5
HINT="重启后有应用不健康"; check "yh start 后全部恢复" sh -c "$YH status | grep -c 正常 | grep -q 3"
HINT="用户数据应保留"; check "重启后用户和配置还在" sh -c "curl -s -X POST $B/api/auth/password -H '$J' -d '{\"username\":\"zhangsan\",\"password\":\"abc12345\"}' | grep -q token"

title "11. 应用独立域名（APPS_URL）：应用和控制台不同源"
A="http://apps.localhost:${B##*:}"
grep -q '^APPS_URL=' yh.env && sed -i.bak "s#^APPS_URL=.*#APPS_URL=$A#" yh.env || echo "APPS_URL=$A" >> yh.env
$YH start > apps-domain.log 2>&1
HINT="见 apps-domain.log"; check "yh start 自动把应用换到应用域名" grep -q 'demo-node：访问地址已换成' apps-domain.log
HINT="应用域名上应 200"; check "应用在应用域名下可访问" [ "$(curl -s -o /dev/null -w '%{http_code}' "$A/apps/demo-node/health")" = 200 ]
HINT="控制台域名的老地址应 302 到应用域名的同一路径"; check "老地址跳到应用域名" [ "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$B/apps/demo-node/health?x=1")" = "302 $A/apps/demo-node/health?x=1" ]
HINT="应用域名上不能有控制台接口和页面"; check "应用域名上没有控制台" sh -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' $A/api/me)\" = 404 ] && ! curl -s $A/ | grep -q 'id=\"app\"'"
AH="$(curl -s -D - -o /dev/null "$A/apps/demo-node/")"
A_LOC="$(echo "$AH" | grep -i '^location:' | tr -d '\r' | cut -d' ' -f2)"; A_CK="$(echo "$AH" | grep -i '^set-cookie:' | tr -d '\r' | cut -d' ' -f2 | cut -d';' -f1)"
HINT="应用的会话 cookie 应限定在 /apps/demo-node"; check "应用域名下 cookie 路径不变（应用不用改）" sh -c "echo '$AH' | grep -i '^set-cookie:' | grep -qi 'Path=/apps/demo-node;'"
A_Q="$(python3 -c "import sys,json,urllib.parse as u; print(json.dumps(dict(u.parse_qsl(u.urlparse(sys.argv[1]).query))))" "$A_LOC")"
A_CB="$(curl -s -X POST "$B/api/sso/authorize" -H "Authorization: Bearer $T_ZS" -H "$J" -d "$A_Q" | jq -r .data.redirect)"
A_NEXT="$(curl -s -D - -o /dev/null -H "Cookie: $A_CK" "$A_CB" | grep -i '^location:' | tr -d '\r' | cut -d' ' -f2)"
HINT="回调应在应用域名，登录后应显示张三"; check "应用域名下统一登录照常" sh -c "case '$A_CB' in $A/apps/demo-node/sso/callback*) ;; *) exit 1;; esac && curl -s -H 'Cookie: $A_CK' '$A$A_NEXT' | grep -q '自测·张三'"
HINT="见 yh doctor"; check "yh doctor 检查应用域名" sh -c "$YH doctor 2>&1 | grep -q '✓ 应用域名：控制台不在这个域名上'"

title "12. 多空间：两家公司在一套平台里互相看不到"
HINT="只有一个空间时不该出现空间"; check "单空间：界面上没有空间" sh -c "curl -s $B/api/me -H 'Authorization: Bearer $T' | jq -e '.data.multiSpace == false'"
SP2="$(api POST /api/admin/spaces -d '{"code":"st-other","name":"自测·兄弟公司"}' | jq -r .data.id)"
HINT="应建出 id > 1 的空间"; check "新建空间" [ "${SP2:-0}" -gt 1 ]
D2="$(api POST /api/org/departments -d "{\"name\":\"兄弟公司·销售\",\"spaceId\":$SP2}" | jq -r .data.id)"
api POST /api/org/users -d "{\"name\":\"自测·王五\",\"username\":\"wangwu\",\"password\":\"abc12345\",\"spaceId\":$SP2,\"deptIds\":[$D2]}" > /dev/null
T_WW="$(login wangwu abc12345)"
HINT="张三查同事不该查到别的空间的王五"; check "查同事按空间收敛" sh -c "curl -s '$B/api/org/users?keyword=%E7%8E%8B%E4%BA%94' -H 'Authorization: Bearer $T_ZS' | jq -e '.data.total == 0' && curl -s '$B/api/org/users?keyword=%E7%8E%8B%E4%BA%94' -H 'Authorization: Bearer $T_WW' | jq -e '.data.total == 1'"
HINT="王五的部门树里不该有研发部"; check "部门树按空间收敛" sh -c "! curl -s $B/api/org/departments -H 'Authorization: Bearer $T_WW' | grep -q '研发部'"
DP="$(api GET /api/admin/apps | jq -r '.data[] | select(.code=="demo-py") | .id')"
HINT="别的空间的应用应看不到"; check "别的空间的应用看不到" sh -c "curl -s $B/api/market/apps -H 'Authorization: Bearer $T_WW' | jq -e '[.data.apps[].code] | index(\"demo-py\") == null'"
api PUT "/api/admin/apps/$DP" -d "{\"extraSpaceIds\":[$SP2]}" > /dev/null
HINT="分享给王五的空间后应看得到"; check "应用分享给别的空间后可见" sh -c "curl -s $B/api/market/apps -H 'Authorization: Bearer $T_WW' | jq -e '[.data.apps[].code] | index(\"demo-py\") != null'"
HINT="/api/me 应返回王五所在的空间"; check "知道用户所在空间" sh -c "curl -s '$B/api/me' -H 'Authorization: Bearer $T_WW' | jq -e '.data.space.code == \"st-other\" and .data.multiSpace == true'"
HINT="有人的空间应拒绝删除"; check "空间里有人时不能删" sh -c "curl -s -X DELETE $B/api/admin/spaces/$SP2 -H 'Authorization: Bearer $T' | jq -e '.code != 0'"

title "13. 资料中心：品牌 VI 给人下载、给 Agent 取用"
AS_ID="$(api POST /api/assets -d '{"category":"BRAND","name":"自测·品牌 VI","spec":{"colors":[{"name":"主色","hex":"#2563EB","usage":"按钮"}]}}' | jq -r .data.id)"
printf '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' > logo.svg
AS_SHA="$(curl -s -X POST "$B/api/assets/$AS_ID/blobs" -H "Authorization: Bearer $T" -H 'Content-Type: application/octet-stream' --data-binary @logo.svg | jq -r .data.sha256)"
HINT="应出 v1"; check "资料：上传文件出 v1" sh -c "curl -s -X POST $B/api/assets/$AS_ID/versions -H 'Authorization: Bearer $T' -H '$J' -d '{\"files\":[{\"name\":\"logo.svg\",\"sha256\":\"$AS_SHA\"}]}' | jq -e '.data.version == 1'"
HINT="普通员工不能新建"; check "资料：只有管理员能新建" sh -c "curl -s -X POST $B/api/assets -H 'Authorization: Bearer $T_ZS' -H '$J' -d '{\"category\":\"OTHER\",\"name\":\"x\"}' | jq -e '.code != 0'"
AS_G="$(skillcall "$KEY" get_brand_guidelines '{}')"
HINT="张三的 Agent 应拿到色值和 SVG 内容"; check "资料：Agent 取品牌规范" sh -c "echo '$AS_G' | jq -e '.brands[0].spec.colors[0].hex == \"#2563eb\" and (.brands[0].files[0].content | contains(\"<svg\"))'"
AS_URL="$(echo "$AS_G" | jq -r '.brands[0].files[0].url')"
HINT="签名地址不带登录也能下，且要有 CSP sandbox"; check "资料：签名下载 + 安全头" sh -c "curl -s -D - -o /dev/null '$AS_URL' | grep -qi '^content-security-policy: sandbox' && [ \"\$(curl -s -o /dev/null -w '%{http_code}' '${AS_URL%sig=*}sig=bad')\" = 403 ]"
HINT="别的空间的王五不该看到"; check "资料：按空间收敛" sh -c "curl -s $B/api/assets -H 'Authorization: Bearer $T_WW' | jq -e '[.data[].id] | index($AS_ID) == null'"

title "14. 版本号与 VI：所有人能看到版本，每个空间可以有自己的 VI"
PV="$(tr -d '[:space:]' < "$DIR/VERSION")"
HINT="/api/me 的 platform.version 应等于 VERSION（$PV）"; check "版本：普通员工能看到平台版本" sh -c "curl -s $B/api/me -H 'Authorization: Bearer $T_ZS' | jq -e '.data.platform.version == \"$PV\" and (.data.platform.channel | test(\"beta|stable\"))'"
HINT="默认应是以虎 VI"; check "VI：默认以虎科技 VI" sh -c "curl -s $B/api/auth/config | jq -e '.data.theme.preset == \"yihu\" and .data.theme.tokens.highlight == \"#d2521e\"'"
api PUT "/api/admin/spaces/$SP2" -d '{"brand":{"name":"兄弟工作台","theme":{"preset":"classic","tokens":{"primary":"#0f766e"}}}}' >/dev/null
HINT="兄弟公司空间的王五应拿到空间 VI，张三（默认空间）跟随平台"; check "VI：空间自己的 VI 只给空间里的人" sh -c "curl -s $B/api/me -H 'Authorization: Bearer $T_WW' | jq -e '.data.brand.name == \"兄弟工作台\" and .data.brand.theme.tokens.primary == \"#0f766e\"' && curl -s $B/api/me -H 'Authorization: Bearer $T_ZS' | jq -e '.data.brand == null'"
HINT="普通员工不能改 VI"; check "VI：只有管理员能改" sh -c "curl -s -X PUT $B/api/admin/settings/appearance -H 'Authorization: Bearer $T_ZS' -H '$J' -d '{\"theme\":{\"preset\":\"classic\"}}' | jq -e '.code != 0'"

# ---- 结果 ----
printf '\n━━━━━━━━ 结果：%s 项通过，%s 项失败 ━━━━━━━━' "$pass" "$fail"
printf "$results\n"
if [ -n "$KEEP" ]; then
  printf '\n环境已保留，用浏览器体验：\n'
  printf '  控制台     %s   （admin / %s，或登录页「开发登录」直接选人）\n' "$B" "$ADMIN_INITIAL_PASSWORD"
  printf '  Node 演示  %s/apps/demo-node/\n' "$B"
  printf '  日志和命令在 %s（cd 进去可以用 ./yh status 等；要试控制台插拔，先在里面跑 ./yh agent）\n' "$DIR"
  printf '  体验完清理：%s --clean\n' "$0"
elif [ "$fail" -gt 0 ]; then
  printf '\n有失败项，环境保留在 %s 以便排查（各步骤日志 *.log，./yh logs <应用>）；排查完 %s --clean\n' "$DIR" "$0"
else
  clean >/dev/null; echo "（已清理；想保留环境体验请加 --keep）"
fi
[ "$fail" -eq 0 ]
