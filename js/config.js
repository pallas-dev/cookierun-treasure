/*
 * 보물 랜덤 뽑기 — 설정
 * 화면에 보이는 이름과 처음 옵션은 여기서 바꿔요. 저장하고 새로고침하면 바로 반영돼요.
 *
 *   보물 목록(자동 생성) → data/treasures.js   ← python3 tools/update_data.py 로 갱신
 *   어떤 보물을 뺄지     → tools/update_data.py 맨 위 "설정"
 */
window.TREASURE_CONFIG = {
  // 한 번에 뽑는 보물 수 (1~9)
  slotCount: 3,

  // 등급 순서. 데이터에 없는 등급은 자동으로 안 보여요.
  grades: ['S', 'A', 'B', 'C'],

  // 종류 이름과 순서. 데이터에 새 종류가 생기면 영어 이름 그대로 뒤에 붙으니, 여기에 한 줄 추가하면 돼요.
  categories: {
    cookie: '쿠키 보물',
    pet: '펫 보물',
    gacha: '뽑기 보물',
    limited: '한정 보물',
    squirrel: '다람쥐 보물',
  },

  // 처음 온 사람에게 적용되는 옵션 (한 번 바꾸면 그 브라우저에 저장돼요)
  defaults: {
    limit: null, //    리롤 횟수: null = 무제한, 0 = 리롤 불가, 숫자 = 한 판에 그 횟수까지 (최대 99)
    count: 3, //       '횟수 지정'을 처음 골랐을 때 들어가 있는 횟수
    noRepeat: false, // 중복 없이 뽑기 — 한 번 나온 보물은 초기화 전까지 다시 안 나옴
    family: true, //   진화 전·후 같은 보물은 함께 안 나옴
    anim: true, //     뽑기 연출
  },
};
