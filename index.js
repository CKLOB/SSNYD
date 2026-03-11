// 1. 주요 클래스 가져오기
const { Client, Events, GatewayIntentBits } = require('discord.js');
const token = process.env.DISCORD_TOKEN;

// 2. 클라이언트 객체 생성 (Guilds관련, 메시지관련 인텐트 추가)
const client = new Client({ intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
]});

// 3. 봇이 준비됐을때 한번만(once) 표시할 메시지
client.once(Events.ClientReady, readyClient => {
console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

// 4. 급식 명령어 처리 (!급식, !밥, !ㅂ, !ㄱㅅ)
// ──────────────────────────────────────────────────
// ※ 나이스 오픈API 설정 (직접 입력하세요)
const NEIS_API_KEY = process.env.NEIS_API_KEY || 'c11ea26f8c614f50bd7b19d2f3228e6d';  // 나이스 오픈API 인증키
const ATPT_CODE    = 'F10';                // 광주광역시교육청 코드
const SCHOOL_CODE  = '7380112';   // 광주소프트웨어마이스터고 학교코드 (나이스에서 확인)
// ──────────────────────────────────────────────────

const https = require('https');

const MEAL_CMDS   = ['!급식', '!밥', '!ㅂ', '!ㄱㅅ'];
const MEAL_LABELS = { 1: '아침', 2: '점심', 3: '저녁' };

// 날짜를 YYYYMMDD 형식으로 변환 (KST 기준)
function toDateStr(kstDate) {
    const y = kstDate.getUTCFullYear();
    const m = String(kstDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(kstDate.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
}

// 현재 시간(KST)에 따라 어떤 식사를 보여줄지 결정
function getMealByTime() {
    const kst  = new Date(Date.now() + 9 * 60 * 60 * 1000); // UTC → KST
    const h    = kst.getUTCHours();
    const min  = kst.getUTCMinutes();
    const t    = h * 60 + min;

    if (t < 7 * 60 + 30)   return { type: 1, dateStr: toDateStr(kst), dayLabel: '오늘' };   // ~07:30  → 아침
    if (t < 12 * 60 + 30)  return { type: 2, dateStr: toDateStr(kst), dayLabel: '오늘' };   // ~12:30  → 점심
    if (t < 18 * 60 + 30)  return { type: 3, dateStr: toDateStr(kst), dayLabel: '오늘' };   // ~18:30  → 저녁
    // 18:30 이후 → 내일 아침
    const tomorrow = new Date(kst.getTime() + 24 * 60 * 60 * 1000);
    return { type: 1, dateStr: toDateStr(tomorrow), dayLabel: '내일' };
}

// 나이스 API에서 급식 메뉴 가져오기
function fetchMeal(dateStr, mealType) {
    const url = `https://open.neis.go.kr/hub/mealServiceDietInfo`
              + `?KEY=${NEIS_API_KEY}&Type=json&pIndex=1&pSize=10`
              + `&ATPT_OFCDC_SC_CODE=${ATPT_CODE}`
              + `&SD_SCHUL_CODE=${SCHOOL_CODE}`
              + `&MLSV_YMD=${dateStr}`
              + `&MMEAL_SC_CODE=${mealType}`;

    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let raw = '';
            res.on('data', chunk => raw += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(raw);
                    if (!json.mealServiceDietInfo) { resolve(null); return; }
                    const row  = json.mealServiceDietInfo[1].row[0];
                    const menu = row.DDISH_NM
                        .replace(/<br\/>/g, '\n')       // 줄바꿈 처리
                        .replace(/\s*\d+(\.\d+)*\s*/g, '') // 알레르기 번호 제거
                        .trim();
                    resolve(menu);
                } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const content = message.content.trim();

    // 급식 명령어인지 확인 (예: !급식, !급식.아침)
    const base = MEAL_CMDS.find(c => content === c || content.startsWith(c + '.'));
    if (!base) return;

    const suffix = content.slice(base.length); // '' | '.아침' | '.점심' | '.저녁'

    const kst     = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const todayStr = toDateStr(kst);

    let mealType, dayLabel, dateStr;

    if (suffix === '.아침') {
        mealType = 1; dayLabel = '오늘'; dateStr = todayStr;
    } else if (suffix === '.점심') {
        mealType = 2; dayLabel = '오늘'; dateStr = todayStr;
    } else if (suffix === '.저녁') {
        mealType = 3; dayLabel = '오늘'; dateStr = todayStr;
    } else if (suffix === '') {
        const info = getMealByTime();
        mealType = info.type; dayLabel = info.dayLabel; dateStr = info.dateStr;
    } else {
        return; // 알 수 없는 서브커맨드
    }

    try {
        const menu = await fetchMeal(dateStr, mealType);
        if (menu) {
            message.reply(`🍽️ **${dayLabel} ${MEAL_LABELS[mealType]} 급식**\n\n${menu}`);
        } else {
            message.reply(`😢 ${dayLabel} ${MEAL_LABELS[mealType]} 급식 정보가 없습니다.`);
        }
    } catch (err) {
        console.error(err);
        message.reply('❌ 급식 정보를 불러오는 중 오류가 발생했습니다.');
    }
});

// 5. 시크릿키(토큰)을 통해 봇 로그인 실행
client.login(token);