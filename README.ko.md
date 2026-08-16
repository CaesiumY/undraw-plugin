# undraw

[English](README.md) | **한국어**

코딩 에이전트에서 unDraw의 [일러스트](https://undraw.co)와
[핸드크래프트](https://handcrafts.undraw.co)를 검색하고, 프로젝트 테마 색상에 맞춰
다시 칠한 SVG를 바로 저장합니다.

```
> 로그인 페이지에 쓸 일러스트 찾아줘

8 results for "login":
 1. Biometric Login — https://undraw.co/illustration/biometric-login_v832
 2. Secure login    — https://undraw.co/illustration/secure-login_m11a
 ...

> 2번으로

Found primary color #3b82f6 in tailwind.config.ts. Save to public/illustrations/?

> ㅇㅇ

Saved public/illustrations/undraw_secure-login_m11a.svg
Recolored #6c63ff -> #3b82f6
```

핸드크래프트는 화살표·밑줄·동그라미 같은 작은 손그림 장식입니다. `currentColor`로
그려져 있어서, 색을 건드리지 않고 두는 것이 보통 요점입니다:

```
> 가격표 제목 밑에 손그림 밑줄 넣어줘

4 results for "underline":
 1. Underline (id 950) — underline, stress, underscore, emphasis   [bold, thin]
 ...

> 1번, thin으로

Saved src/components/pricing/icons/undraw_underline_950_thin.svg
Kept currentColor — the artwork inherits the CSS `color` around it.
```

## 빠른 시작

Claude Code에서:

```bash
/plugin marketplace add CaesiumY/undraw-plugin
```

이어서 `/plugin install undraw@undraw-plugin`을 실행한 뒤, 평소 말하듯 요청하면
됩니다 — *"장바구니 빈 상태에 넣을 일러스트 찾아줘"*, 또는 *"CTA 옆에 손그림 화살표
넣어줘"*. 에이전트가 검색해서 후보를 보여주고, 스타일시트에서 테마 색상을 읽어온
다음, 확인을 받고 파일을 씁니다. 다른 호스트는 [설치](#설치)를 보세요.

설치 전에 동작만 먼저 보고 싶다면 클론해서 번들 CLI를 바로 돌려도 됩니다. Node 18
이상만 있으면 되고, 빌드하거나 내려받을 것은 없습니다:

```bash
git clone https://github.com/CaesiumY/undraw-plugin
node undraw-plugin/scripts/undraw.mjs search "login" --limit 5
node undraw-plugin/scripts/undraw.mjs handcrafts search "arrow" --limit 5
```

## 설치

### Claude Code

```bash
/plugin marketplace add CaesiumY/undraw-plugin
```

이어서 `/plugin install undraw@undraw-plugin`.

### Codex, Cursor, Copilot, VS Code, Kiro

[Agent Plugins 1.0](https://agent-plugins.org) 매니페스트(`plugin.json`)를
포함하며, 위 호스트들이 이 형식을 읽습니다. 각 호스트의 플러그인 설치 방식으로 이
저장소를 지정하세요.

### Gemini CLI

```bash
gemini extensions install https://github.com/CaesiumY/undraw-plugin
```

### SKILL.md를 읽는 모든 호스트 — 수동

저장소를 클론하고 에이전트가 스킬을 탐색하는 위치(보통 `.agents/skills/`,
`~/.claude/skills/`, `.gemini/skills/`)에 링크를 겁니다:

```bash
git clone https://github.com/CaesiumY/undraw-plugin
```

```bash
ln -s "$PWD/undraw-plugin/skills/undraw-illustrations" ~/.agents/skills/undraw-illustrations
```

```bash
ln -s "$PWD/undraw-plugin/skills/undraw-handcrafts" ~/.agents/skills/undraw-handcrafts
```

둘 중 하나만 설치해도 됩니다 — 서로 상대방의 파일을 참조하지 않습니다.

링크 대신 복사해도 됩니다 — 스크립트가 없으면 스킬이 이를 감지해 Node 없는 경로로
넘어갑니다.

## 요구 사항

빠른 경로에는 Node 18 이상이 필요합니다. 없어도 일러스트 스킬은 동작합니다 —
`curl`(Windows에서는 PowerShell)로 내려가 에이전트가 같은 흐름을 밟되, 색상 변환은
직접 해야 합니다.

핸드크래프트는 Node가 없을 때 더 많이 깎입니다. 그쪽 사이트는 API 자체가 없어서,
Node 없는 경로는 카탈로그 목록까지만 보여주고 실제 다운로드는 사이트의 다운로드
버튼으로 넘깁니다. 핸드크래프트를 쓸 생각이면 Node를 설치하세요.

npm 의존성은 없고 빌드할 것도 없습니다.

## 언제 동작하나

이름을 불러 호출할 필요는 없습니다. 그림이 필요하다고 말하면 되고, 둘 중 어느 스킬이
답할지는 무엇을 요청했는지가 결정합니다:

| 이렇게 말하면 | 이렇게 동작합니다 |
|---|---|
| "로그인 페이지에 쓸 일러스트 찾아줘" | 페이지 용도가 아니라 소재인 `login`으로 검색 |
| "404 페이지에 넣을 그림 필요해" | `404` / `error`로 검색 |
| "빈 상태에 넣을 그림 찾아줘" | 같은 흐름으로 진행 |
| "회원가입 페이지 일러스트" | 마찬가지 — 스킬 트리거는 한국어와 영어를 모두 받습니다 |
| "undraw에서 가져와줘" | 출처를 직접 지정 |
| "제목 밑에 손그림 밑줄 넣어줘" | 핸드크래프트 — 장면이 아니라 장식 |
| "CTA 가리키는 손그림 화살표" | 마찬가지로 핸드크래프트 |

기준선은 **장면이냐 표식이냐**입니다. 히어로 이미지, 빈 상태, 에러 페이지, 온보딩
아트, 플레이스홀더 벡터는 **일러스트**입니다. 무언가를 가리키거나 강조하는 화살표,
밑줄, 동그라미, 체크, 별, 낙서는 **핸드크래프트**입니다.

둘 다 같은 6단계를 거칩니다: 검색 → 사용자가 선택 → 저장 위치 제안 → 색상 제안 →
저장 → 결과 보고. 둘 다 파일을 쓰기 전에 경로와 색상을 확인받고, 명시적으로 시키지
않는 한 그림을 대신 고르지 않습니다.

분기 하나짜리 스킬 하나가 아니라 **스킬 두 개**인 이유는, 스킬을 발동시키는 것이
`description` 필드이기 때문입니다. 두 의도를 한 description에 담으면 양쪽 모두에
발동한 뒤 어느 쪽인지 추측하게 됩니다. 로그인 페이지 그림을 요청했는데 200바이트
화살표를 돌려주는 실패를 피하려고 나눈 것입니다.

## 무엇이 다른가

**스타일시트에 적힌 형태가 곧 입력 형식입니다.** 이미 선언돼 있는 값을 그대로
`--color`에 넘기면 됩니다 — 함수 표기 없이 채널만 적은 shadcn식 HSL(`214 92% 58%`),
Tailwind v4의
`oklch(0.514 0.222 16.935)`, `rgb(49 130 246)` 전부 받습니다. 손으로 변환할 일이
없습니다.

**핸드크래프트는 따로 말하지 않는 한 `currentColor`를 그대로 둡니다.** 변환하지
않는 쪽이 더 나은 기본값입니다. 그래야 주변 CSS `color`를 상속해서 다크 모드와 호버
상태를 공짜로 따라갑니다. 저장할 때마다 CLI가 이 사실을 알려 주고, `<img src>`나 CSS
배경으로 쓰면 상속이 안 돼 **검게** 렌더된다는 주의도 함께 출력합니다.

**CDN URL을 슬러그로 조립하지 않습니다.** 카탈로그의 경로 세그먼트가 일관되지
않아서, 한 번의 검색 결과 안에 두 표기가 나란히 나옵니다:

```
1. Biometric Login   → https://cdn.undraw.co/illustration/biometric-login_v832.svg
2. Fingerprint login → https://cdn.undraw.co/illustrations/fingerprint-login_19qv.svg
```

슬러그로 추측한 URL은 라이브러리 상당수에서 404가 납니다. 그래서 `search` 결과의
`media` 필드를 그대로 전달합니다.

**핸드크래프트 파일명에는 id가 들어갑니다. 제목이 고유하지 않기 때문입니다.**
카탈로그에 `Circled Arrow`라는 항목이 두 개 있습니다. 사이트 자체 규칙대로면 둘 다
`undraw_circled-arrow.svg`라서, 첫 번째가 이미 있는 디렉터리에 두 번째를 저장하면
조용히 지워집니다. 그래서 `undraw_<제목-슬러그>_<id>.svg`로 저장합니다.

**대체할 수 없는 파일은 덮어쓰지 않습니다.** `--out`은 `.svg`로 끝날 때만 파일로
취급합니다. 기존 `hero.png`를 가리키면 래스터 이미지 위에 SVG 텍스트를 쓰는 대신
exit 1로 거부합니다.

**의존성도, 빌드도, 락 파일도 없습니다.** Node 18 이상에서 도는 `.mjs` 파일 하나가
전부입니다. Node가 없으면 일러스트 스킬은 `curl` 전용 경로로 내려가 같은 흐름을
밟지만, 거기서는 색상을 직접 변환해야 하고 스크립트의 응답·파일명 검사도 적용되지
않습니다.

**한 번에 파일 하나씩만 받습니다.** 설계가 그렇습니다. 대량 다운로드도, 로컬
미러링도, 디스크 캐시도 하지 않으며, 저장하는 파일마다 unDraw 공식 다운로더가 넣는
것과 같은 출처 속성을 써넣습니다. 이유는 [라이선스](#라이선스)에 있습니다.

**모든 테스트는 실제로 있었던 결함을 고정합니다.** 러너도, 의존성도, 네트워크도
없습니다. 각 단언이 실제로 발생했던 버그 또는 카탈로그에 실재하는 특이 케이스를
붙잡고 있으므로, 실패는 취향 차이가 아니라 회귀입니다.

## CLI 직접 사용하기

번들된 스크립트만 따로 떼어 써도 됩니다:

```bash
node scripts/undraw.mjs search "empty cart" --limit 5
node scripts/undraw.mjs search "empty cart" --json

node scripts/undraw.mjs get "https://cdn.undraw.co/illustration/foo_ab12.svg" \
  --out public/illustrations --color "#3b82f6"
```

종료 코드: `0` 성공, `1` 사용법 오류(핸드크래프트 이름이 둘 이상에 걸리는 경우 포함),
`2` 네트워크/HTTP 오류 또는 handcrafts.undraw.co 페이지 번들의 구조가 바뀜,
`3` 검색 결과 없음, 에셋이 404, 요청한 스타일이 없음, 또는 응답이 SVG가 아님,
`4` 출력 파일을 쓰지 못함.

`--color`는 스타일시트에 이미 쓰고 있는 형태를 그대로 받습니다 — 직접 변환할 필요가
없습니다:

| 입력 | 결과 |
|---|---|
| `#3b82f6` | 그대로 사용 |
| `214 92% 58%` | 함수 표기 없는 shadcn/ui식 HSL 채널 → hex로 변환 |
| `hsl(214 92% 58%)` | hex로 변환 |
| `rgb(49 130 246)` / `rgb(50% 20% 90%)` | hex로 변환 |
| `oklch(0.514 0.222 16.935)` | 변환 없이 그대로 기록 (CSS Color 4 렌더러 필요) |

`hsl()`이나 `rgb()` 값을 hex로 변환할 때는 알파를 버리고(SVG `fill`은 색상만
받습니다), 버렸다는 사실도 출력에 함께 알려 줍니다. hex와 CSS Color 4 값은 알파를
포함해 적힌 그대로 기록합니다.

`--out`은 `.svg`로 끝날 때만 파일로 취급하고, 그 외에는 디렉터리로 보고 없으면
만듭니다. `.svg`가 아닌 기존 파일을 가리키면 조용히 덮어쓰는 대신 거부합니다 —
`hero.png` 위에 SVG 텍스트를 쓰는 것이 의도였을 리 없습니다.

`--limit`은 50을 넘길 수 없습니다 — 더 큰 값은 잘라내지 않고 거부합니다. 검색은
20페이지에서 멈추거나 새로운 결과가 없는 페이지가 나오는 즉시 멈춥니다. API 응답
구조가 바뀌어도 루프가 폭주하지 않습니다.

**`search`가 준 `media` URL을 그대로 넘기세요.** CDN 경로는 슬러그에서 유도할 수
없습니다 — 최근 일러스트는 `/illustration/` 아래, 오래된 것은 `/illustrations/`
아래에 있어서, 슬러그로 조립한 URL은 카탈로그 상당수에서 404가 납니다. `get`은
`cdn.undraw.co` URL만 받습니다. 옆에 함께 출력되는 `preview` URL은 에셋이 아니라
웹 페이지라서 거부됩니다.

### 핸드크래프트

```bash
node scripts/undraw.mjs handcrafts search "underline" --limit 5
node scripts/undraw.mjs handcrafts get 950 --out src/components/pricing/icons --style thin
```

**제목이 아니라 id를 넘기세요.** 제목이 고유하지 않아서, 둘 이상에 걸리는 이름은
추측으로 하나를 고르지 않고 exit 1과 함께 해당 id 목록을 출력합니다. 정확히 하나에만
걸리는 이름(`arrow` → `Arrow`)은 그대로 동작합니다.

**여기서 `--color`는 선택이고, 보통은 넘기지 않는 편이 낫습니다** — 위의 *무엇이
다른가*를 보세요. 상속이 불가능한 곳에 쓸 파일일 때만 넘기면 됩니다.

`--style`은 `bold`(사이트 기본값) 또는 `thin`입니다. 모든 항목이 둘 다 갖고 있지는
않습니다. `Sneaker`는 thin만 있습니다. `--style`을 생략하면 존재하는 쪽으로 넘어가고
그 사실을 알려 줍니다. 없는 쪽을 명시하면 exit 3인데, 그건 사용자가 지정했기
때문입니다.

미리보기 URL은 없습니다 — handcrafts.undraw.co는 모달 하나짜리 단일 페이지라 항목별
링크가 존재하지 않습니다. <https://handcrafts.undraw.co/app>에서 둘러보세요.

## 테스트

```bash
node scripts/undraw.test.mjs
```

러너도, 의존성도, 네트워크도 없습니다. 모든 단언이 한때 실재했던 결함을 고정한
것이라, 실패는 스타일에 대한 의견이 아니라 회귀입니다 — 해당 케이스가 지키는 코드를
고치기 전에 케이스부터 읽으세요.

## 범위

다루는 범위: [일러스트 라이브러리](https://undraw.co)와
[Handcrafts](https://handcrafts.undraw.co).

unDraw의 나머지 공개 도구 둘은 범위 밖입니다. API가 없어서가 아니라 **감쌀 카탈로그
자체가 없어서**입니다:

- [Code Videos](https://videos.undraw.co)는 *사용자가 붙여넣은* 코드 스니펫을
  MP4로 만듭니다. 에셋이라는 것이 아예 없습니다.
- [Banner cards](https://cards.undraw.co)는 *사용자가 제공한* 이미지 주위로 카드를
  구성합니다("카드를 클릭하거나 새 이미지를 끌어다 놓으세요"). 에디터 번들에 프리셋
  이나 템플릿 목록이 없고, sitemap은 URL 두 개가 전부입니다.

**Handcrafts는 취약한 쪽이고, 의존하기 전에 왜 그런지 알아둘 값어치가 있습니다.**
API가 없고, 카탈로그가 배포마다 파일명 해시가 바뀌는 페이지 청크 안에 JavaScript
배열 리터럴로 인라인돼 있습니다. 이건 해결됐다기보다 완화된 상태입니다:

- 청크 경로를 실행 시점에 `/app`에서 찾아내므로, 해시가 바뀌어도 비용이 없습니다;
- 파서가 필드를 키 기준으로 읽고 따라갈 수 없는 항목은 건너뛰므로, 필드가 추가되거나
  순서가 바뀌어도 치명적이지 않습니다;
- 쓸 수 있는 항목이 20개 미만이면 짧은 목록을 조용히 돌려주는 대신 exit 2와 이슈
  트래커 링크로 멈춥니다;
- 파서는 카탈로그에 실재하는 특이 케이스를 픽스처 테스트로 고정해 뒀습니다 —
  아트워크가 없는 플레이스홀더 항목, 스타일 변형이 하나뿐인 항목, 제목이 겹치는 항목
  두 개.

상류에서 구조를 다시 짜면 여전히 깨집니다. 다만 그럴 때 조용히가 아니라 요란하게
실패합니다.

## 라이선스

**라이선스 조문은 영어 원문이 기준입니다** — <https://undraw.co/license>와
<https://handcrafts.undraw.co/license>. 아래 인용 블록은 원문 그대로이고, 각 인용
뒤의 한국어는 참고용 요지입니다.

이 저장소의 플러그인 코드는 MIT입니다(`LICENSE` 참조). **그림은 아닙니다.** 두
라이브러리는 서로 다른 라이선스를 따르고 내용도 동일하지 않으니, 이 도구를 쓰기 전에
둘 다 읽어봐야 합니다.

### 일러스트

unDraw는 에셋을 *사용*하는 데는 관대합니다:

> "You can use them for noncommercial and commercial purposes. You do not need
> to ask permission from or provide credit to the creator or unDraw."

비상업·상업 용도 모두 허용하며, 제작자나 unDraw의 허락을 받거나 출처를 표기할
의무는 없다는 뜻입니다.

하지만 *취득* 방식은 제한합니다:

> "This license does not include the right to compile assets, vectors or images
> from unDraw to replicate a similar or competing service, in any form or
> distribute the assets in packs or otherwise. This extends to automated and
> non-automated ways to link, embed, scrape, search or download the assets
> included on the website without our consent."

이 라이선스에는 두 가지가 포함되지 않습니다. 하나는 유사하거나 경쟁하는 서비스를
만들기 위해 unDraw의 에셋·벡터·이미지를 어떤 형태로든 모으는 것이고, 다른 하나는
에셋을 묶음으로든 그 밖의 방식으로든 배포하는 것입니다(후자는 경쟁 서비스 목적이
아니어도 마찬가지입니다). 이 제한은 동의 없이 웹사이트에 있는 에셋을
링크·임베드·스크랩·검색·다운로드하는 자동/수동 방식 모두에 적용됩니다.

AI 학습 용도는 명시적으로 금지합니다:

> "This license explicitly prohibits the use of unDraw assets, vectors, and
> images for training, fine-tuning, or developing artificial intelligence,
> machine learning models, or similar technologies."

unDraw의 에셋·벡터·이미지를 인공지능, 머신러닝 모델, 또는 이와 유사한 기술의
학습·파인튜닝·개발에 쓰는 것을 명시적으로 금지한다는 뜻입니다.

덧붙여 `undraw.co/robots.txt`는 `anthropic-ai`를 포함한 여러 AI 유저 에이전트를
지목해 `/*.svg$`와 `/download/*`를 차단하고 있으며, 해당 항목의 제목은
`# AI Training Protection - only for artwork`입니다.

이 도구는 취득을 자동화하므로 제한 대상 범주에 들어갑니다. 웹사이트의 다운로드
버튼이 하는 일과 마찬가지로, 사용자가 자기 프로젝트에 쓸 일러스트를 하나씩 받는
용도로만 쓴다는 전제 위에 공개했으며, 미러나 경쟁 카탈로그를 만들려는 것이
아닙니다. 대량 다운로드를 하지 않고, 에셋을 재배포하지 않으며, unDraw 공식
다운로더가 넣는 것과 같은 `artist`·`copyright` 속성을 각 SVG에 써넣습니다.

그 범위를 넘는 사용이 필요하다면 unDraw에 연락해 동의를 받으세요. 명확한 오픈
라이선스의 일러스트가 필요하다면 [Open Peeps](https://openpeeps.com)(CC0)나
[Humaaans](https://humaaans.com)(CC BY 4.0)를 보세요.

### 핸드크래프트

Handcrafts 라이선스는 위쪽보다 문구가 더 셉니다. 그리고 그 추가된 문구가 이 플러그인
정확히 위에 떨어집니다. 요약에서는 이렇게 하지 말라고 합니다:

> "replicate unDraw Handcrafts, redistribute the artworks in packs or create
> integrations for it."

unDraw Handcrafts를 복제하거나, 아트워크를 묶음으로 재배포하거나, **이를 위한
integration을 만들지** 말라는 뜻입니다.

제한 조항은 이렇게까지 확장됩니다:

> "automated and non-automated ways to link, embed, scrape, search, use for
> generative AI training purposes or download the assets included on the website
> and integration without our consent."

동의 없이 웹사이트 **및 integration**에 포함된 에셋을 링크·임베드·스크랩·검색·생성형
AI 학습 목적 사용·다운로드하는 자동/수동 방식 모두에 적용된다는 뜻입니다.

"create integrations for it"도 "and integration"도 메인 라이브러리 라이선스에는 없는
문구입니다. **그 문구대로라면 이 플러그인은 integration이므로**, 핸드크래프트에
대해서는 일러스트보다 한 발 더 나간 것입니다. 얼버무리지 않고 여기 적어 둡니다.
이것만으로 이 기능을 쓰지 않겠다고 판단해도 충분히 합리적이기 때문입니다.

이 도구의 나머지 부분과 같은 전제 위에 공개했습니다. 사용자가 자기 프로젝트에 쓸
표식을 하나 받는 것, 즉 사이트의 다운로드 버튼이 하는 일과 같습니다. 구체적으로
핸드크래프트 경로는

- 필요할 때 받아서 `get` 한 번에 파일을 정확히 하나만 씁니다;
- **카탈로그를 캐시하거나 디스크에 쓰지 않습니다.** 의도적입니다 — 그걸 저장하는
  것이 라이선스가 금지하는 "compile assets" 그 자체이고, 나중에 "최적화"로 되돌아오지
  않도록 `scripts/undraw.mjs`에 규칙 3으로 못박아 뒀습니다;
- 사이트 다운로더가 넣는 `creator`·`origin` 속성을 보존합니다;
- 요청이 있으면 내립니다.

한 가지 사실은 반대 방향을 가리키고, 그것도 여기 적는 것이 맞습니다. 위 일러스트
절에서 `robots.txt`를 이 도구에 불리한 근거로 인용했기 때문입니다:
`handcrafts.undraw.co/robots.txt`는 완전히 개방돼 있습니다 — `User-agent: *`에
`Disallow:`가 비어 있고, `undraw.co`와 달리 AI 에이전트를 따로 지목하지 않습니다.

일러스트·핸드크래프트 제작: [Katerina Limpitsouni](https://twitter.com/ninaLimpi).

---

이 문서는 [README.md](README.md)의 번역본입니다. 내용이 어긋날 경우 영문판이
기준입니다.
