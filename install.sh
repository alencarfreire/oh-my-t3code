#!/usr/bin/env bash
set -euo pipefail

REPO="alencarfreire/oh-my-t3code"
APP_NAME="Oh My T3Code.app"
PROCESS_NAME="oh-my-t3code"
INSTALL_DIR="/Applications"
TARGET_APP="${INSTALL_DIR}/${APP_NAME}"
REQUESTED_VERSION="${1:-${VERSION:-latest}}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Erro: este instalador é exclusivo para macOS." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
MOUNT_DIR="${TMP_DIR}/mnt"
mkdir -p "${MOUNT_DIR}"

cleanup() {
  if mount | grep -Fq "on ${MOUNT_DIR} "; then
    hdiutil detach "${MOUNT_DIR}" -quiet || hdiutil detach "${MOUNT_DIR}" -force -quiet || true
  fi
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

download_with_gh() {
  local tag="$1"
  if [[ "${tag}" == "latest" ]]; then
    gh release download --repo "${REPO}" --pattern "*_universal.dmg" --dir "${TMP_DIR}"
  else
    gh release download "${tag}" --repo "${REPO}" --pattern "*_universal.dmg" --dir "${TMP_DIR}"
  fi
}

download_with_curl() {
  local tag="$1"
  local api_url
  if [[ "${tag}" == "latest" ]]; then
    api_url="https://api.github.com/repos/${REPO}/releases/latest"
  else
    api_url="https://api.github.com/repos/${REPO}/releases/tags/${tag}"
  fi

  local release_json
  if ! release_json="$(curl -fsSL -H "Accept: application/vnd.github+json" "${api_url}" 2>/dev/null)"; then
    echo "Erro: não foi possível consultar a release (${tag}) em ${REPO}." >&2
    echo "Se o repositório for privado, autentique o GitHub CLI com 'gh auth login' e execute novamente." >&2
    exit 1
  fi

  local dmg_url
  dmg_url="$(printf '%s' "${release_json}" | grep -oE 'https://[^"]+_universal\.dmg' | head -n 1 || true)"
  if [[ -z "${dmg_url}" ]]; then
    echo "Erro: nenhum arquivo *_universal.dmg encontrado na release ${tag}." >&2
    exit 1
  fi

  local dmg_name
  dmg_name="$(basename "${dmg_url}")"
  curl -fL --progress-bar -o "${TMP_DIR}/${dmg_name}" "${dmg_url}"
}

echo "==> Baixando ${APP_NAME} (${REQUESTED_VERSION}) de ${REPO}..."
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  download_with_gh "${REQUESTED_VERSION}"
else
  download_with_curl "${REQUESTED_VERSION}"
fi

DMG_PATH="$(find "${TMP_DIR}" -maxdepth 1 -name '*_universal.dmg' | head -n 1 || true)"
if [[ -z "${DMG_PATH}" || ! -f "${DMG_PATH}" ]]; then
  echo "Erro: arquivo .dmg não encontrado após o download." >&2
  exit 1
fi

echo "==> Montando $(basename "${DMG_PATH}")..."
hdiutil attach "${DMG_PATH}" -nobrowse -readonly -mountpoint "${MOUNT_DIR}" -quiet

SOURCE_APP="${MOUNT_DIR}/${APP_NAME}"
if [[ ! -d "${SOURCE_APP}" ]]; then
  echo "Erro: '${APP_NAME}' não encontrado dentro da imagem .dmg." >&2
  exit 1
fi

if pgrep -x "${PROCESS_NAME}" >/dev/null 2>&1; then
  echo "==> Encerrando instância em execução de ${PROCESS_NAME}..."
  pkill -x "${PROCESS_NAME}" || true
  sleep 1
fi

echo "==> Instalando em ${TARGET_APP}..."
if [[ -w "${INSTALL_DIR}" ]]; then
  rm -rf "${TARGET_APP}"
  ditto "${SOURCE_APP}" "${TARGET_APP}"
else
  sudo rm -rf "${TARGET_APP}"
  sudo ditto "${SOURCE_APP}" "${TARGET_APP}"
fi

echo "==> Removendo quarentena do Gatekeeper..."
if [[ -w "${TARGET_APP}" ]]; then
  xattr -dr com.apple.quarantine "${TARGET_APP}" 2>/dev/null || true
  codesign -dv "${TARGET_APP}" >/dev/null 2>&1 || codesign --force --deep --sign - "${TARGET_APP}" >/dev/null 2>&1 || true
else
  sudo xattr -dr com.apple.quarantine "${TARGET_APP}" 2>/dev/null || true
  codesign -dv "${TARGET_APP}" >/dev/null 2>&1 || sudo codesign --force --deep --sign - "${TARGET_APP}" >/dev/null 2>&1 || true
fi

echo "==> Concluído! ${APP_NAME} instalado em ${TARGET_APP}."
echo "    Para abrir agora: open \"${TARGET_APP}\""
