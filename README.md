# Keywords Automation App

React �Ǘ� UI �� Express API �� 1 �� Node.js �v���W�F�N�g�ɂ܂Ƃ߂��\���ł��BFirestore ���f�[�^�X�g�A�ɁAGemini�EGoogle Ads API�E�Ǝ��X�P�W���[���ŃL�[���[�h���T�[�`?�A�E�g���C������?�L�����e�܂ł����������܂��B

## �f�B���N�g���\��

```
index.html          Vite �G���g��
src/                React + Firebase �Ǘ� UI
server/             Express API �ƃX�P�W���[���AGemini/Ads/Blogger �A�g
  lib/core          ���L���[�e�B���e�B
  lib/gemini        Gemini �N���C�A���g
  lib/ads           �L�[���[�h�A�C�f�A�擾�N���C�A���g
  lib/blogger       �L�����e���W�b�N
  lib/scheduler     Firestore �ƘA�g����p�C�v���C��
api/[[...slug]].ts  Vercel �����T�[�o���X�G���g�� (Express app �����b�v)
vercel.json         Vite �o�͐� (dist/client) ���w��
```

## �X�N���v�g

| �R�}���h | ���� |
| --- | --- |
| `npm install` | �ˑ��֌W���C���X�g�[�� (�W���ݒ�) |
| `npm run dev` | Vite �J���T�[�o (3000) �� Express API (3001) �𓯎��N�� |
| `npm run build` | �T�[�o (`dist/server`) �ƃt�����g (`dist/client`) ���r���h |
| `npm run preview` | �r���h�ς݃t�����g�����[�J���Ŋm�F |
| `npm run start` | �r���h�ς� Express API ���N�� |

`scripts/test-google-ads.js` �� `test.js` �� `npm run build` �ς݂̐��ʕ���D�悵�A�r���h�O�� `ts-node` ���g���� TypeScript �\�[�X��ǂݍ��݂܂��B

## �J���菇

1. `.env` �� Firebase�EGemini�EFirestore�EGoogle Ads �Ȃǂ̃T�[�o���ϐ���ݒ肵�܂��B
2. `src/lib/firebase.ts` �ŎQ�Ƃ��� Vite �p�̒l�� `.env.local` �Ȃǂ� `VITE_FIREBASE_*`�A`VITE_API_BASE_URL` (�C�ӁA���ݒ�Ȃ� `/api`) ���L�q���܂��B
3. `npm run dev` �����s����ƁAVite (http://localhost:3000) �� `/api` �� http://localhost:3001 �փv���L�V���AReact UI ���� API ��@���܂��B

## �f�v���C (Vercel)

1. `npm install` �� `npm run build` ���f�t�H���g�Ŏ��s����A`dist/client` �Ƀt�����g�A`dist/server` �� Express�{�X�P�W���[�����o�͂���܂��B
2. `vercel.json` �� `outputDirectory` �� `dist/client` �ɐݒ�ς݂ł��B
3. `api/[[...slug]].ts` �̓r���h�ς݂� `dist/server/app.js` ��ǂݍ��݁AVercel ��� `/api/*` ���N�G�X�g�� Express �ɈϏ����܂��B�r���h�O�Ƀf�v���C����� 500 �ɂȂ邽�߁A�K�� `npm run build` �����������Ă��������B
4. Firebase�EGemini�EGoogle Ads�ETavily �Ȃǂ̊��ϐ��� Vercel �v���W�F�N�g�֐ݒ肵�܂��B

## Firestore / �@�\

- �v���W�F�N�g�E�e�[�}�E�m�[�h�E�L�[���[�h�E�N���X�^�E�����N�E�W���u�Ƃ������h�L�������g�\���͏]���̂܂܂ł��B
- React UI ����̑���͂��ׂ� `/api/projects/...` �z���� Express ���[�g�֑��M����A�T�[�o���� Firestore / Gemini / Ads / Blogger ���W�b�N�����s���܂��B
- �X�P�W���[���̃p�C�v���C�� (�A�C�f�A�擾���N���X�^�����O���X�R�A�����O���A�E�g���C�������������N���u���O���e) ���]���ʂ� `server/lib/scheduler` �ɂ܂Ƃ܂��Ă��܂��B
