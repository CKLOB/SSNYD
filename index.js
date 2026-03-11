const { Client, Events, GatewayIntentBits } = require('discord.js');
const token = process.env.DISCORD_TOKEN;

const client = new Client({ intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
]});

client.once(Events.ClientReady, readyClient => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

const NEIS_API_KEY = process.env.NEIS_API_KEY || 'c11ea26f8c614f50bd7b19d2f3228e6d';
const ATPT_CODE    = 'F10';
const SCHOOL_CODE  = '7380292';

const https = require('https');

const MEAL_CMDS   = ['!급식', '!밥', '!ㅂ', '!ㄱㅅ'];
const MEAL_LABELS = { 1: '아침', 2: '점심', 3: '저녁' };

function toDateStr(kstDate) {
    const y = kstDate.getUTCFullYear();
    const m = String(kstDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(kstDate.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
}

function getMealByTime() {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const h   = kst.getUTCHours();
    const min = kst.getUTCMinutes();
    const t   = h * 60 + min;

    if (t < 7 * 60 + 30)  return { type: 1, dateStr: toDateStr(kst), dayLabel: '오늘' };
    if (t < 12 * 60 + 30) return { type: 2, dateStr: toDateStr(kst), dayLabel: '오늘' };
    if (t < 18 * 60 + 30) return { type: 3, dateStr: toDateStr(kst), dayLabel: '오늘' };
    const tomorrow = new Date(kst.getTime() + 24 * 60 * 60 * 1000);
    return { type: 1, dateStr: toDateStr(tomorrow), dayLabel: '내일' };
}

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
                        .replace(/<br\/>/g, '\n')
                        .trim()
                        .split('\n')
                        .map(item => `• ${item.trim()}`)
                        .join('\n');
                    const cal = row.CAL_INFO || '';
                    resolve({ menu, cal });
                } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

let todoSchedule = null;

setInterval(() => {
    if (!todoSchedule) return;
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const h   = kst.getUTCHours();
    const min = kst.getUTCMinutes();
    if (h === todoSchedule.hour && min === todoSchedule.minute) {
        const hh = String(todoSchedule.hour).padStart(2, '0');
        const mm = String(todoSchedule.minute).padStart(2, '0');
        todoSchedule.channel.send(`# ${hh}:${mm}에 오늘 한거 적으세용`);
    }
}, 60 * 1000);

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const content = message.content.trim();
    const lower   = content.toLowerCase();

    if (lower.startsWith('!todo.start')) {
        const suffix = content.slice('!todo.start'.length);

        let hour = 23, minute = 50;

        if (suffix !== '') {
            const match = suffix.match(/^\((\d{2}):(\d{2})\)$/);
            if (!match) {
                message.reply('❌ 형식이 올바르지 않습니다. 예: `!todo.start(23:50)`');
                return;
            }
            hour   = parseInt(match[1]);
            minute = parseInt(match[2]);
            if (hour > 23 || minute > 59) {
                message.reply('❌ 올바른 시간을 입력하세요. (00:00 ~ 23:59)');
                return;
            }
        }

        todoSchedule = { channel: message.channel, hour, minute };
        const hh = String(hour).padStart(2, '0');
        const mm = String(minute).padStart(2, '0');
        message.reply(`✅ 매일 ${hh}:${mm}에 알림을 보낼게요.`);
        return;
    }

    if (lower === '!todo.end') {
        if (!todoSchedule) {
            message.reply('❌ 실행 중인 알림이 없습니다.');
        } else {
            todoSchedule = null;
            message.reply('✅ 알림을 종료했습니다.');
        }
        return;
    }

    const base = MEAL_CMDS.find(c => content === c || content.startsWith(c + '.'));
    if (!base) return;

    const mealSuffix = content.slice(base.length);

    const kst      = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const todayStr = toDateStr(kst);

    let mealType, dayLabel, dateStr;

    if (mealSuffix === '.아침') {
        mealType = 1; dayLabel = '오늘'; dateStr = todayStr;
    } else if (mealSuffix === '.점심') {
        mealType = 2; dayLabel = '오늘'; dateStr = todayStr;
    } else if (mealSuffix === '.저녁') {
        mealType = 3; dayLabel = '오늘'; dateStr = todayStr;
    } else if (mealSuffix === '') {
        const info = getMealByTime();
        mealType = info.type; dayLabel = info.dayLabel; dateStr = info.dateStr;
    } else {
        return;
    }

    try {
        const result = await fetchMeal(dateStr, mealType);
        if (result) {
            message.reply(`🍽️ **${dayLabel} ${MEAL_LABELS[mealType]} 급식**\n\n${result.menu}\n\n${result.cal}`);
        } else {
            message.reply(`😢 ${dayLabel} ${MEAL_LABELS[mealType]} 급식 정보가 없습니다.`);
        }
    } catch (err) {
        console.error(err);
        message.reply('❌ 급식 정보를 불러오는 중 오류가 발생했습니다.');
    }
});

client.login(token);
