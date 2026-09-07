# AdAtlas 회사 Windows 운영 컴퓨터 구성

이 구성의 역할은 다음처럼 고정합니다.

- 개발 Mac: 코드 수정, 레퍼런스 추가·분류·OCR 검수, GitHub 반영
- GitHub: 코드와 `data/native-creative-reference-library.json`, `public/creative-references/reference-copy/` 배포
- 회사 Windows 컴퓨터: 수동·자동 광고 제작 실행, 생성 결과와 작업 기록 보관

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
ADATLAS_REFERENCE_LIBRARY_READ_ONLY=true
```

`C:/AdAtlasData`에는 다음 운영 데이터가 저장됩니다.

- 수동·자동 생성 작업 JSON
- 완성 이미지와 단계별 작업 파일
- 자동제작 광고주 설정·실행 기록·ZIP
- 아카이브 메모·후처리 이미지·개별 광고 문구
- Codex 이미지 세션 정리 기록과 기타 런타임 캐시

레퍼런스 386장과 manifest는 이 폴더로 복사하지 않습니다. 이 둘은 Git으로 업데이트되는 읽기 전용 제작 원본입니다.

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

회사 컴퓨터에서는 코드나 레퍼런스를 직접 수정하지 않습니다. 따라서 `git status --short` 결과가 비어 있어야 안전하게 업데이트할 수 있습니다. 생성 결과와 작업 기록은 `C:/AdAtlasData`에 있어 이 업데이트의 영향을 받지 않습니다.

## 7. 다른 사내 사용자가 접속해야 할 때

다른 컴퓨터에서 접속시키는 작업은 사내 방화벽·인증·도메인 설정을 확인한 다음 별도로 진행합니다. 개인 ChatGPT 로그인이나 Codex 세션 폴더를 외부에 공유하지 말고, 우선 회사 승인 사용자만 사용하는 내부 운영 컴퓨터로 검증합니다.
