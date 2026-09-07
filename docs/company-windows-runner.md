# AdAtlas 회사 Windows 운영 컴퓨터 구성

이 구성의 역할은 다음처럼 고정합니다.

- 개발 Mac: 코드 수정과 GitHub 반영
- GitHub: 코드와 `data/native-creative-reference-library.json`, `public/creative-references/reference-copy/` 배포
- 회사 Windows 컴퓨터: 수동·자동 광고 제작 실행, 레퍼런스 추가·분류, 생성 결과와 작업 기록 보관

회사 컴퓨터에 저장되는 생성 결과는 Git 저장소 밖 `C:/AdAtlasData`에 두므로 `git pull`, 재빌드, 서버 재시작으로 삭제되지 않습니다. 환경변수를 설정하지 않은 개발 Mac은 지금처럼 저장소 내부의 기존 데이터 경로를 그대로 사용합니다.

## 1. 회사 컴퓨터에 한 번만 설치

다음을 설치합니다.

1. Git for Windows
2. Node.js 22 LTS
3. Visual Studio Code는 선택 사항입니다. 서버 실행 자체에는 필요하지 않습니다.

PowerShell에서 설치 여부를 확인합니다.

```powershell
git --version
node --version
npm --version
```

## 2. GitHub 저장소 내려받기

원하는 설치 폴더에서 실행합니다.

```powershell
git clone https://github.com/Joxxdam/adatlas.git
cd adatlas
npm ci
```

이때 레퍼런스 manifest와 실제 레퍼런스 이미지도 함께 내려받아집니다.

## 3. 회사 컴퓨터 전용 환경 설정

프로젝트 루트에 `.env.local`을 만들고 개발 Mac의 필요한 서버 설정을 옮깁니다. 키와 토큰은 GitHub에 올리지 않습니다. 아래 두 값은 회사 컴퓨터에서 반드시 다음처럼 설정합니다.

```dotenv
ADATLAS_RUNTIME_DATA_ROOT=C:/AdAtlasData
ADATLAS_REFERENCE_LIBRARY_READ_ONLY=false
```

`C:/AdAtlasData`에는 다음 운영 데이터가 저장됩니다.

- 수동·자동 생성 작업 JSON
- 완성 이미지와 단계별 작업 파일
- 자동제작 광고주 설정·실행 기록·ZIP
- 아카이브 메모·후처리 이미지·개별 광고 문구
- Codex 이미지 세션 정리 기록과 기타 런타임 캐시

레퍼런스 이미지와 manifest는 이 폴더로 복사하지 않고 Git 저장소 내부에 유지합니다. 회사 컴퓨터의 관리 화면에서 새 레퍼런스를 업로드하면 해당 회사 컴퓨터의 저장소에 바로 추가되고 수동·자동 제작에 즉시 사용됩니다. 업로드만으로 정밀 OCR은 자동 실행되지 않으며, 필요할 때 관리 화면의 `미분석 전체 OCR` 버튼으로 직접 실행할 수 있습니다.

## 4. Codex 로그인

프로젝트가 사용하는 OS별 Codex 실행 파일은 `npm ci`에서 함께 준비됩니다. PowerShell에서 로그인합니다.

```powershell
npx codex login
npx codex login status
```

`Logged in using ChatGPT` 상태여야 기본 이미지 제작이 실행됩니다. AdAtlas는 로컬 Codex 로그인 엔진이 실패해도 유료 이미지 API로 자동 전환하지 않습니다.

## 5. 3000포트 실행

```powershell
npm run build
npm run start -- -p 3000
```

같은 컴퓨터의 브라우저에서 `http://localhost:3000`을 엽니다. PowerShell 창을 닫거나 컴퓨터가 절전·종료되면 제작 서버와 자동제작도 멈춥니다.

## 6. 나중에 Mac의 변경 사항 적용

먼저 개발 Mac에서 변경을 커밋하고 GitHub에 push합니다. 회사 컴퓨터에서는 진행 중인 제작이 끝난 뒤 서버를 중지하고 다음을 실행합니다.

```powershell
git status --short
git pull --ff-only
npm ci
npm run build
npm run start -- -p 3000
```

회사 컴퓨터에서는 코드를 직접 수정하지 않습니다. 다만 관리 화면에서 레퍼런스를 업로드하면 이미지 파일과 manifest가 회사 컴퓨터의 Git 작업 폴더에 추가되므로 `git status --short`가 비어 있지 않을 수 있습니다. 이 경우 새 레퍼런스를 별도로 보존하거나 Git에 반영하기 전에는 `git pull`로 덮어쓰지 않습니다. 생성 결과와 작업 기록은 `C:/AdAtlasData`에 있어 코드 업데이트의 영향을 받지 않습니다.

## 7. 다른 사내 사용자의 인증된 접속

AdAtlas에는 별도 비밀번호를 저장하지 않습니다. 공개 주소 앞에 Cloudflare
Tunnel과 Cloudflare Access를 두고, Access가 로그인시킨 사용자의 서명된 JWT를
AdAtlas 서버가 다시 검증합니다. 회사 컴퓨터의 `localhost:3000`과 내부 자동
러너는 기존처럼 동작합니다.

Cloudflare Zero Trust에서 다음 순서로 설정합니다.

1. `Networks > Tunnels`에서 회사 컴퓨터용 Tunnel을 만듭니다.
2. Tunnel의 Windows 설치 화면에 표시되는 `cloudflared.exe service install ...`
   명령을 회사 컴퓨터의 관리자 PowerShell에서 한 번 실행합니다. 화면의 긴
   토큰은 `.env.local`이나 GitHub에 복사하지 않습니다.
3. Public hostname을 정하고 Service를 `http://localhost:3000`으로 연결합니다.
4. `Access controls > Applications`에서 같은 hostname의 `Self-hosted`
   애플리케이션을 만듭니다.
5. Allow 정책에는 실제 사용을 승인한 이메일 또는 회사 이메일 도메인만
   넣습니다. 로그인 방식은 One-time PIN을 사용할 수 있습니다.
6. Access 애플리케이션의 `Audience (AUD) tag`와 계정의 Team domain을
   확인합니다.

회사 컴퓨터의 `.env.local`에 아래 값을 추가합니다.

```dotenv
ADATLAS_CLOUDFLARE_ACCESS_TEAM_DOMAIN=https://회사팀이름.cloudflareaccess.com
ADATLAS_CLOUDFLARE_ACCESS_AUD=Access_애플리케이션의_AUD_값
```

값을 저장한 뒤 AdAtlas 서버를 재시작합니다. 브라우저가 공개 hostname에
접속하면 Cloudflare 로그인 화면이 먼저 표시됩니다. 로그인 후 수동 제작을
요청하면 작업에는 Access 사용자 식별자와 이메일만 저장되고 JWT·쿠키·비밀번호는
저장되지 않습니다. 외부 사용자는 본인이 요청한 수동 작업과 아카이브만 볼 수
있지만, 대기 순번은 모든 수동 요청의 실제 FIFO 순서를 기준으로 표시됩니다.

중요한 운영 원칙:

- Tunnel과 Access를 모두 구성하기 전에는 공개 hostname을 배포하지 않습니다.
- 공유기 포트포워딩으로 3000번 포트를 인터넷에 직접 열지 않습니다.
- 개인 ChatGPT 로그인, Codex 상태 폴더, `.env.local`을 다른 사용자에게
  공유하지 않습니다.
- Cloudflare Access 애플리케이션을 다시 만들면 AUD가 바뀔 수 있으므로
  `.env.local`의 AUD도 갱신하고 서버를 재시작합니다.

## 8. 코드 업데이트 뒤 재시작

Cloudflare Tunnel은 코드를 호스팅하지 않으므로 6절의 `git pull`, `npm ci`,
빌드, 서버 재시작 과정은 그대로 필요합니다. Tunnel 프로세스도 Windows에서
서비스로 등록해 두어야 컴퓨터 재부팅 뒤 자동으로 다시 연결됩니다.
