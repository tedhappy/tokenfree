// 从 FreeTokenNav 抓取的数据生成 sites.json
// 用法: node scripts/import-nav.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../src/data/sites.json');

// [name, b64url, tags, multiplier|null, models, summary, description, status, featured]
// 描述整理自 freetokennav.com 公开页面（2026-08-22 抓取）
const RAW = [
  ['ApxRelay', 'aHR0cHM6Ly9hcHhyZWxheS5jb20vcmVnaXN0ZXI/YWZmPU1OUlkyQTkzUFk5Mg==', ['邀请', '稳定'], null, ['gpt'], '新站，基本上每天都有 0.001x 的倍率，可进群等消息', '新站，基本上每天都有0.001x的倍率，可进群等消息。速度很快，经常搞活动，模型全部是GPT。充值是10元起。', 'stable', true],
  ['HUBWAY', 'aHR0cHM6Ly9odWJ3YXkuY2MvcmVnaXN0ZXI/YWZmPVpOTVFSRUZGQURXNg==', ['生图', '邀请', '稳定'], 0.04, ['gpt', 'claude'], '新站，注册即送5刀，进群可再领10刀，限时 0.01 分组', '新站，注册即送5刀，进群可再领取10刀。【限时0.01分组】模型有Claude、GPT，GPT限时0.4倍率。因为充值是1:10，相当于0.04倍。', 'stable', true],
  ['云舟API', 'aHR0cHM6Ly9jbGkuOTk5NTU0Lnh5ei9yZWdpc3Rlcj9hZmY9blZqdA==', ['邀请', '稳定'], 0.05, ['grok', 'deepseek'], 'Grok-4.5 免费用，DeepSeek V4 flash 长期免费（公益分组）', '【Grok-4.5免费用！！！】DeepSeek V4 flash长期免费，使用公益分组。其他付费使用，但codex经常是0.05倍率。站长人很好，调用也比较稳定。', 'stable', false],
  ['Agent Router', 'aHR0cHM6Ly9hZ2VudHJvdXRlci5vcmcvcmVnaXN0ZXI/YWZmPWM5cXo=', ['签到'], null, ['gpt', 'claude', 'gemini'], '口碑炸裂的老牌公益站，注册得50刀，每天签到再得25刀', '非常老的站，为数不多口碑炸裂的公益站。模型很多，免费公益使用，非常良心。注册就可以获得50刀，每天签到还可以获得25刀，可用L站或Github登录。', 'stable', true],
  ['Uni Token', 'aHR0cHM6Ly91bmktdG9rZW4uY29tL3JlZ2lzdGVyP2FmZj1KSFpUOExURTg0Nkc=', ['稳定'], 0.01, ['gpt', 'claude', 'gemini', 'grok'], '注册送 ChatGPT 限时免费日卡，倍率 0.01', '新站，注册送ChatGPT「限时免费日卡」，倍率0.01。模型丰富，涵盖Claude、ChatGPT、Gemini、Grok。免费日卡不限量。', 'stable', true],
  ['CTAI', 'aHR0cHM6Ly9haS5jaGVuZ3Rpbmdrai5jb20vcmVnaXN0ZXI/YWZmPVM4NTg3WVAzTUhYVw==', [], 0.01, ['gpt'], '进群领5刀，GPT 0.01x 倍率，每天不定时开放', '新站，注册不送，进群领5刀。GPT现在是0.01x倍率。经过一个月测试，每天都不定时开放0.01x，值得冲。', 'stable', true],
  ['GuysCode', 'aHR0cHM6Ly93d3cuZ3V5c2NvZGUuY29tL3JlZ2lzdGVyP2FmZj1hdWlW', ['签到'], null, ['claude'], '非常稳定的老站，注册进群找群主领3刀，每天可签到', '非常稳定的老站了，注册进群找群主领3刀。限时可蹬满血Fable5。每天还可以签到。', 'stable', true],
  ['发财API', 'aHR0cHM6Ly9hcGkuZGFsaTI4OTcuY29tL3JlZ2lzdGVyP2FmZj1ZTFBI', ['签到', '生图', '邀请'], 0.07, ['gpt'], '注册送2余额，签到随机送，plus 0.07x，可生图', '注册有2余额、签到随机送，签到天数越多送的越多。plus 0.07x、pro 0.18x，非常耐用，可生图。邀请累计奖励制度。', 'stable', true],
  ['登仙API', 'aHR0cHM6Ly9hcGkuZGVueGlvLnRvcC9yZWdpc3Rlcj9pbnZpdGVfY29kZT1FN1BKUlFLUzRLNlM=', ['签到', '生图', '邀请'], null, ['gpt', 'claude', 'gemini'], '纯公益站，经常搞活动，注册得10仙缘，签到0.5-1仙缘/天', '纯公益站，经常搞活动，近期恢复稳定。新用户注册可得10仙缘，邀请新用户可得5仙缘，每日签到随机获得0.5-1仙缘。', 'stable', true],
  ['Super NB', 'aHR0cHM6Ly9zdXBlci1uYi5tZS9yZWdpc3Rlcj9hZmY9VzhNTDhYREI4TTcy', ['邀请', '稳定'], null, ['gpt', 'claude'], '注册即送50刀，加群再送10刀（长期有效）', '新站，注册即送50刀！加群再送10刀（长期有效），要进群at群主才送。模型有GPT（pro+plus）和Claude（max+pro）。', 'stable', true],
  ['TrueSota', 'aHR0cHM6Ly90cnVlLXNvdGEuY29tL3JlZ2lzdGVyP2FmZj1WRFBONVNMU0pLSlE=', ['邀请'], 0.35, ['gpt'], '注册就送20刀，倍率0.35x，模型基本只有 ChatGPT', '新站，注册就送20刀，倍率0.35x。模型基本只有ChatGPT，说是Pro官号。拉1人送20刀，每周可拉10人。', 'stable', false],
  ['AllinAI', 'aHR0cHM6Ly9hbGxpbmFpLnNob3AvcmVnaXN0ZXI/YWZmPVoyRks5TFFRSkdIVQ==', [], 0.12, ['gpt'], '注册送50刀月卡，每天限额3刀，PLUS分组 0.12x', '新站，注册就送50刀月卡，但是每天限额3刀，每周15刀。PLUS分组0.12x，价格偏高，限制也比较严。', 'stable', false],
  ['JustDoWork', 'aHR0cHM6Ly9hcGkuanVzdHdva2VyLmljdS9zaWduLXVwP2FmZj1scGND', ['签到'], null, ['claude'], '注册就送70刀，签到送30刀，模型只有 claude opus 4.8 和 opus 5', '新站，注册就送70刀，签到送30刀。模型只有claude opus 4.8和opus 5。', 'stable', false],
  ['启悟流', 'aHR0cHM6Ly83NTY3NzcueHl6L3JlZ2lzdGVyP2FmZj1YVE4zUExHTkVRM0E=', ['邀请'], 0.0499, [], '注册后加群领取体验额度20刀/周，充值1:10 相当于0.0499x', '新站，注册后加群领取体验额度20刀/周。此站活动比较多，一般是拉新活动。充值比例是1:10，相当于倍率0.0499x。', 'stable', false],
  ['TaBiAI', 'aHR0cHM6Ly90YWJpdG9rZW4uY29tL3NpZ24tdXA/YWZmPWVmOTc=', ['签到'], null, ['claude'], 'GitHub邀请码注册送120刀，每日送随机额度，可用 opus 5', 'GitHub邀请码注册送120刀，每日送随机额度，可用opus5。限时注册，错过了又要等很久。', 'stable', false],
  ['OurChat API', 'aHR0cHM6Ly9vdXJjaGF0LnNob3AvcmVnaXN0ZXI/YWZmPVQ4MDU=', ['签到'], 0.01, [], '注册送2刀，倍率0.01x，实测首字速度1s内', '新站，注册送2刀，倍率0.01x。注册使用用户名验证邮箱即可，实测首字速度1s内。活动不清楚什么时间结束，还有签到。', 'stable', false],
  ['StraitAPI', 'aHR0cHM6Ly9zdHJhaXRhcGkuY29tL3NpZ24tdXA/YWZmPUlyY1Y=', [], null, [], 'QQ邮箱注册得2刀，首充得3刀，每日不定时开 0.01 倍率', '通过链接用QQ邮箱注册得2刀，首充任意金额得3刀，群内每天做活动可兑换token。每日不定时开0.01倍率。', 'stable', false],
  ['LLM HOST', 'aHR0cHM6Ly9sbG1ob3N0Lm5ldC9zaWduLXVwP2FmZj10NURa', ['签到'], null, ['deepseek', 'grok'], 'deepseek v4 flash / grok 4.6 / mimo-v2.5 免费用', '注册送0.2，有签到。deepseek v4 flash免费用、grok 4.6免费用、mimo-v2.5免费用。想用GPT可能要签到很久。', 'stable', false],
  ['ZAI-Abyss', 'aHR0cHM6Ly9hcGkuMDYwOTEzLnh5ei9yZWdpc3Rlcj9hZmY9RU5KTVVGVkJNNVFE', [], 0.01, [], '注册送0.5刀，加群再领1刀，每晚10-12点开放0.01分组', '新站，注册送0.5刀，今日倍率0.01，加群找管理再领1刀。充值1元起，速度很不错。每晚10:00-12:00开放0.01分组，白天恢复0.06。', 'stable', false],
  ['RedStoneAPI', 'aHR0cHM6Ly9hcGkubWNteS5sb3ZlL3JlZ2lzdGVyP2FmZj0yVzZCRTZTOE5XR0Y=', [], 0.01, [], '注册加群送0.5刀，0.01x 倍率，可用约6000万token', '新站，注册加群送0.5刀，0.01x的倍率，大概可用6000万token。分组比较多，请选择K12速蹬的那个分组。', 'stable', false],
  ['SotaAI', 'aHR0cHM6Ly93d3cuc290YW1vZGVsLm5ldC9zaWduLXVwP2FmZj1BYlhv', ['签到'], 1, ['gpt'], '注册就送100刀，首页签到再送300刀，倍率1x', '注册就送100刀，首页agents页面底部签到再送300刀，一共400刀！倍率是1x。注册邀请码：80HUXEQM。', 'stable', false],
  ['卡皮巴拉API', 'aHR0cHM6Ly9rYXBpYmFsYS5hc2lhL3NpZ24tdXA/YWZmPXFFUzI=', ['签到'], 1, ['gpt'], '邀请码注册送22刀，每日签到0.2刀，邀请他人送20刀', '使用邀请码注册赠送22刀，每日签到0.2刀，邀请他人送20刀。codex分组倍率1x，实际上20刀可能也就是6刀。适合当个备用。', 'stable', false],
  ['ooioo', 'aHR0cHM6Ly9vb2lvby53b3JrL3NpZ24tdXA/YWZmPUpoYjg=', [], 0.08, ['gpt'], 'L站注册送5刀，帖子评论送30刀，codex-plus 0.08x', 'L站注册送5刀，帖子下面评论id或用户名送30刀。codex-plus x0.08，gpt-5.6-sol codex-plus 0.08。', 'stable', false],
  ['SoulEcho AI 发电站', 'aHR0cHM6Ly9haS5zb3VsZWNoby5jYy9zaWduLXVwP2FmZj1Wc2d6RnJlY3pMdGM=', ['签到'], 0.245, ['gpt'], '注册有5刀（兑换卡），gpt plus 0.245，每日签到1.5-5刀', '注册有5刀，注册登录会有个兑换卡，然后去兑换。gpt plus倍率0.245，实际充值1:10。每日签到1.5-5刀。', 'stable', false],
  ['粥Pro', 'aHR0cHM6Ly9jb25nZWUucHJvL3JlZ2lzdGVyP2FmZj1OUFRQTU5ZSzhROTM=', ['稳定'], 0.2, ['gpt'], 'L站登录送5刀+评论送5刀+加群送5刀，0.2x 倍率', '使用L站登录送5刀，L站评论送5刀，加群再送5刀，一共15刀。0.2x的倍率，全部是正价Pro20x账号。速度还不错。', 'stable', false],
  ['Grox', 'aHR0cHM6Ly93d3cubWNncm94LnRvcC9yZWdpc3Rlcj9hZmY9RVRBUlhYRUxVVENS', [], null, ['gpt'], '进群绑定账号领100刀日卡，模型全GPT，速度非常快', '注册不送，注册后进群绑定账号后可领100刀日卡。模型全部都是GPT，有5.6-sol，速度非常快。属于日抛型。', 'stable', false],
  ['Twinkle Model', 'aHR0cHM6Ly9iaWctbW9kZWwuc21hcnQtYWdpLmNvbS9yZWdpc3Rlcj9hZmY9UEtMRlZUTDhCQzJF', ['签到'], 0.18, ['gpt'], '回帖送10刀，加v进群再送50刀，GPT PRO 20X 号池', '注册后回帖送10刀，加v进群再送50刀。号池都全走GPT PRO 20X，首字98%低于5秒内，1比10充值。平时1.8x倍率按1:10算相当于0.18x。', 'stable', false],
  ['HHHToken', 'aHR0cHM6Ly9zdWIyLmhoaHRva2VuLmNjL3JlZ2lzdGVyP2FmZj1EV0hSM1AzRTdCUEw=', [], 0.01, ['gpt'], '注册送10刀，主要都是GPT模型，速度不错', '新站，注册送10刀，今天倍率只有0.01。主要都是GPT模型，模型速度都不错。', 'stable', false],
  ['JuCodex', 'aHR0cHM6Ly9qdWNvZGV4LmNvbS9yZWdpc3Rlcj9hZmY9ZGdVRA==', [], 0.05, ['gpt'], '注册送1刀，QQ邮箱注册再送2刀，GPT 0.05x', '注册送1刀，不要用Github，用QQ邮箱注册再送2刀。模型比较多，GPT现在是0.05x的倍率。实测速度还不错，有时候还会搞抽奖。', 'stable', false],
  ['君の星辰', 'aHR0cHM6Ly9haS5jZW50b3MuaGsvcmVnaXN0ZXI/YWZmPTZJVng=', [], 0.02, ['gpt'], '模型很多，GPT 0.02x，大名鼎鼎的君的站', '非公益站。模型很多，GPT现在是0.02x的倍率。该站是大名鼎鼎的君的，可靠性没得说。', 'stable', false],
  ['JiuRelay', 'aHR0cHM6Ly9qaXVyZWxheS5jb20vci9KUi1RR0FWVFY=', [], null, ['grok', 'claude'], 'glm-5.2 / grok 4.5 / claude-sonnet-5 分别免费3/2/1小时', '目前可以用glm-5.2和grok 4.5以及claude-sonnet-5，分别免费3小时、2小时、1小时，要用的时候大量用。', 'stable', false],
  ['咯咯哒', 'aHR0cHM6Ly9zYnNncWV3LmRwZG5zLm9yZy9yZWdpc3Rlcj9hZmY9NDI0TlRRNVFSWkJU', [], 0.005, ['grok'], 'grok 一直很稳，倍率只有 0.005x，注册送1刀', '老站了，注册好像是送1刀。grok一直都很稳，并且倍率只有0.005x。送的少但是很耐用。', 'stable', false],
  ['奇点', 'aHR0cHM6Ly9zdWIyYXBpLnByb3h5LWdscy5kZGUubmV0L3JlZ2lzdGVyP2FmZj1NTk5YM1VGNUpXVkw=', [], null, ['claude'], '收费站，注册送0.1刀，Claude Fable 5 限时 0.001x', '奇点的收费站，注册送0.1刀。Claude Fable 5限时0.001x。搞活动的时候还不错，可以注册当作备用。', 'stable', false],
  ['豆豆', 'aHR0cHM6Ly9iaXpkZWNpcGhlci5jb20vcmVnaXN0ZXI/YWZmPVUzQjk1WUtOMzJBQQ==', ['签到'], 0.001, ['grok'], '注册送2刀，玩法多（共享市场等），grok 0.001x', '注册送2刀，每日可签到得积分。此站玩法比较多，有共享市场等。现在grok是0.001x，基本上可以用很久。', 'stable', false],
  ['肖恩AI', 'aHR0cHM6Ly9mcmVlLnN1cHhoLnhpbi9yZWdpc3Rlcj9jb2RlPVZBWkFGQg==', ['签到'], null, [], '免费大模型 API，注册即送7000额度，邀请双方各得2000', '免费大模型API，注册即送7000额度！每邀请1人，双方各得2000额度。累计邀请20人，送无限量周卡。', 'stable', false],
  ['Aizzz', 'aHR0cHM6Ly9hcGkuYWl6enoueHl6L3NpZ24tdXA/YWZmPXZtRkw=', ['稳定'], 0.01, ['grok', 'gpt'], '非公益，Grok 0.01x，GPT 平时0.05x，较稳定', '非公益站，Grok分组倍率是0.01x，充1块钱能用很久。另外也有GPT，平时0.05x，低价时候也有0.01x。注册不送，需要充值。', 'stable', false],
  ['99code', 'aHR0cHM6Ly9ncHQuYXBpNDU2Lm1lLz9hZmY9N21Zag==', ['签到'], null, ['gpt'], 'gpt 超低价源头公益站，邀请注册送50算力点，签到无上限', 'gpt超低价源头公益站，通过邀请注册送50算力点。邀请一位好友赠送150算力点，每日还可签到领算力，无上限。', 'stable', false],
  ['tokora', 'aHR0cHM6Ly90b2tvcmEudmlwL3NpZ24tdXA/YWZmPUIyOVY=', [], null, ['gpt'], '免费蹬分组（0x），GPT 首字3s内', '新站，今天免费蹬，分组里有一个免费蹬分组，0x。模型有GPT，速度还不错，首字在3s内。', 'stable', false],
  ["1412's API", 'aHR0cHM6Ly9uYXBpLmtpZDE0MTIucXp6LmlvL3NpZ24tdXA/YWZmPUJGd2k=', ['签到'], null, [], '注册即送95刀，每天签到，可买订阅套餐约1700刀', '新站，注册即送95刀，每天还有签到，签到还能得不少。直接去买两个订阅套餐，大概可以用1700刀左右。速度一般，但额度不少。', 'stable', false],
  ['发现AI', 'aHR0cHM6Ly93d3cuZmluZGNnLmNvbS9yZWdpc3Rlcj9hZmY9TUdWQkIzWTdTMkM3', ['生图', '稳定'], 0.001, ['claude', 'gpt', 'gemini', 'grok'], '老站，注册送0.1刀，GPT 0.001 倍率，模型多', '老站了，注册送0.1刀，但是目前GPT倍率0.001，可以蹬很久。模型比较多，有Claude、GPT、Gemini、Grok等等。', 'stable', false],
  ['XelvAI API', 'aHR0cHM6Ly94ZWx2YWkuY29tL3JlZ2lzdGVyP2FmZj1ENVA5SjJHRlgyNU0=', ['稳定'], 0.01, ['gpt'], '注册即送5刀，加群找管理再送5刀，GPT 0.01x', '新站，注册即送5刀，加群找管理再送5刀。模型主要是GPT，有5.6，倍率0.01x，很耐蹬。', 'stable', false],
  ['MyDamoxing', 'aHR0cHM6Ly9teWRhbW94aW5nLmNuL3JlZ2lzdGVyP2FmZj0ydDl2', ['邀请', '稳定'], 0.001, ['claude', 'gpt', 'gemini', 'grok'], '注册送1刀，限时0.001倍，模型丰富含很多国模', '新站，注册就送1刀，限时0.001倍，也相当于100刀了。模型丰富，有Claude、GPT、Gemini、Grok等，还有很多国模。', 'stable', false],
  ['分享奇点', 'aHR0cHM6Ly9hcGktcHVibGljLnByb3h5LWdscy5kZGUubmV0L3NpZ24tdXA/YWZmPWFUMkQ=', ['签到', '邀请'], 0.25, ['claude', 'gpt', 'grok', 'gemini'], '注册即送30刀，签到每天5-8刀，倍率约0.25x', '新站，注册即送30刀，可签到，大概5-8刀每天。模型：claude-fable-5、claude-opus-4.8、gpt-5.6、grok-4.5、gemini等。倍率大概0.25x左右。', 'stable', false],
  ['七倍算力', 'aHR0cHM6Ly83eC5oay9zaWduLXVwP2FmZj1YSWFK', ['签到'], 2, ['gpt'], '注册即送105刀，签到再得20刀/天，倍率2x', '新公益站，注册即送105刀，每天签到再得20刀。模型主要是GPT，有gpt-5.6-sol。倍率是2x，虽然比较高，但公益的可以用一用。', 'stable', false],
  ['CUN.AI', 'aHR0cHM6Ly93d3cuY3VuLmFpL3NpZ24tdXA/YWZmPXJXc2Y=', ['签到', '邀请', '稳定'], null, ['claude', 'gpt', 'gemini'], '注册即送8.8刀，模型丰富含各种国模', '新站，注册即送8.8刀，有签到功能。模型很丰富，有Claude/ChatGPT/Gemini，还有各种国模。', 'stable', false],
  ['LUNA', 'aHR0cHM6Ly9sdW5hLWFpLnNob3AvcmVnaXN0ZXI/YWZmPTI5VFE5UFU4SEdHNg==', ['邀请'], null, ['gpt'], 'GPT 免费蹬，注册后兑换处输入兑换码领88', '【7.7更新】GPT免费蹬！注册0余额，但是不要钱！GPT5.5，实测速度3s之内，注册完到兑换处输入：感谢管理小哥，兑换88。', 'stable', false],
  ['Star API', 'aHR0cHM6Ly90b2tlbi5zdGVsbGFpc2xlLmNvbS9yZWdpc3Rlcj9hZmY9MklqQQ==', ['邀请'], 0.16, ['claude', 'gpt'], '加群找群主领5刀，Claude 0.28x / GPT 0.16x', '新站，加qq群找群主领取额度5刀。Claude最低0.28倍率，GPT最低0.16倍率，pro是0.2的倍率。', 'stable', false],
  ['词元站', 'aHR0cHM6Ly9haS45NjI4MzEueHl6L3JlZ2lzdGVyP2FmZj1TU1Az', ['签到', '生图'], 0.05, ['gpt'], '注册送1元，0.05倍率，gpt 5.5 可生图', '注册送1元，倍率是0.05，有签到。模型主要是gpt，有5.5，可以生图。额度较少，但倍率比较低，大概可以用1-2千万token。', 'stable', false],
  ['乾行AI', 'aHR0cHM6Ly9mYXN0LnFpYW54aW5nLnByby9zaWduLXVwP2FmZj1PTHY0', ['签到'], 0.1, ['claude', 'gpt', 'gemini'], '注册送2刀，加群再送5刀，倍率约0.1', '注册送2刀，加QQ群私聊群主再送5刀。模型有Claude、ChatGPT、Gemini，倍率不高。速度还不错。', 'stable', false],
  ['TokensHub', 'aHR0cHM6Ly9hcGkudG9rZW5zaHViLnNpdGUvcmVnaXN0ZXI/YWZmPUdXNFNXOEEyWFZBUw==', [], null, ['claude', 'gpt'], '注册领20刀 pro 3日卡，首充额外赠20%', '新用户注册即领20刀 pro 3日体验卡，首充额外赠送20%额度。模型有Claude和ChatGPT，Max、Pro、Plus都有，速度很快。', 'stable', false],
  ['年华API', 'aHR0cHM6Ly9uZXdhcGkubWFrZWxvdmUuY2xvdWQvc2lnbi11cD9hZmY9ME1IWA==', ['签到', '邀请'], null, ['gpt', 'claude', 'gemini'], '注册送+签到送，模型丰富，当备选', '注册送，有签到，签到也送。模型有ChatGPT、Claude、Gemini，相当丰富。速度还不错，额度不多，当做备选。', 'stable', false],
  ['小白Code', 'aHR0cHM6Ly90b2tlbi5kaWFsb2d1ZWR1aS5jb20vcmVnaXN0ZXI/YWZmPTlWNzVXNTM2TU1YWA==', ['签到', '稳定'], null, ['gpt', 'claude'], '注册送1刀，签到0.25刀/天，ChatGPT/Claude 应用尽有', '注册送1刀，有签到，每日签到可得0.25刀。ChatGPT、Claude应用尽有，plus pro max等等。额度少但签到能送，而且非常稳定。', 'stable', false],
  ['RawChat', 'aHR0cHM6Ly9uZXcuc2hhcmVkY2hhdC5jYy9saXN0LyMvcmVnaXN0ZXI/aT1DTzJUSQ==', ['稳定'], null, ['gpt'], '新用户体验200次卡，gpt-5.5 速度非常快', '新站，非公益，注册就可以享受新用户体验200次卡。可使用gpt-5.5模型，实测速度非常快。200次大概能用50刀左右。', 'stable', false],
  ['J3GB', 'aHR0cHM6Ly92aXAuajNnYi5jb20vcmVnaXN0ZXI/YWZmPVg3Q1NCN1lDRkJFRg==', [], null, ['gpt'], '注册送10刀，gpt5.5 首字2s内，当备用站', '新站，注册送10刀。gpt5.5模型的速度非常快，首字在2s内。送的不多，但作为备用站还算是不错。', 'stable', false],
  ['CloudNexus', 'aHR0cHM6Ly9hcGkuYWlmbXVzaWMudG9wL3JlZ2lzdGVyP2FmZj1TTldVRjVKWDlKSks=', [], null, ['deepseek'], '注册送一个月会员，每天可用35刀，国模为主', '新站，注册送一个月订阅会员，每天可用35刀。主要是国模，DeepSeek/Kimi/MiniMax/GLM等。', 'stable', false],
  ['维云', 'aHR0cHM6Ly92c2xsbS5jb20vcmVnaXN0ZXI/YWZmPTJMaHA=', ['签到', '生图', '邀请'], null, ['claude', 'gpt', 'gemini'], '大站，签到+红包玩法多，实测速度4s内', '这是个大站，注册好像不送，但是可以签到，还有各种红包玩法。模型丰富，Claude、GPT、Gemini，很多国模也都免费。实测4s内。', 'stable', false],
  ['二狗子', 'aHR0cHM6Ly9lcmdvdXppLmxpZmUvcmVnaXN0ZXI/YWZmPWhjMDM=', ['稳定'], 0.01, ['claude', 'gpt', 'deepseek'], '非公益，注册送0.15，0.01-0.03 低倍率分组多', '非公益站，注册送0.15。倍率很低，0.01、0.02、0.03的分组特别多。模型也多，涵盖Claude、GPT、DeepSeek、GLM、Kimi、MiniMax、Mimo等。临时应急没问题。', 'stable', false],
  ['Bluesminds', 'aHR0cHM6Ly9hcGkuYmx1ZXNtaW5kcy5jb20vcmVnaXN0ZXI/YWZmPXlZSU8=', ['邀请'], null, ['claude', 'gpt', 'deepseek'], '注册就送100刀，模型覆盖广', '新站，注册就送100刀！模型有Claude、GPT、Kimi、DeepSeek、GLM等等。整体速度还不错。', 'stable', false],
  ['CaMeL AI', 'aHR0cHM6Ly9jYW1lbC5rcjc3Ny50b3AvcmVnaXN0ZXI/YWZmPVp4VTA=', ['签到'], null, ['gpt', 'claude', 'gemini'], '注册送3刀，绑教育邮箱每日还有2刀', '非公益站，注册送3刀，如果绑定教育邮箱，每日还有2刀的福利。模型有GPT、Claude、Gemini、国模等。临时应个急。', 'stable', false],
  ['VC API', 'aHR0cHM6Ly9zdWIudmNub3ZiLmNuL3JlZ2lzdGVyP2FmZj1aQkFMMjU3UlYzTEY=', ['邀请'], null, ['gpt', 'claude', 'gemini'], '注册送5刀，邀请1人再送5刀', '新站，非公益，注册送5刀，邀请1人再送5刀。模型覆盖gpt、claude、Gemini、国模等。', 'stable', false],
  ['Future Hub', 'aHR0cHM6Ly9hcGkuZnV0dXJlcHBvLnRvcC9yZWdpc3Rlcj9hZmY9NzBSeQ==', ['签到', '生图', '邀请'], null, ['claude'], '纯公益，注册送10刀，签到10-20刀，仅限 GitHub/edu/LinuxDo', '纯公益站，注册送10刀，签到得10-20刀。无gpt，有Claude opus 4.8，很多国模免费。仅支持GitHub、edu.cn邮箱、LinuxDo账号注册。严禁批量测活和二次分发。', 'stable', false],
  ['斑马API', 'aHR0cHM6Ly9ibWFwaS4wMjAyMTIueHl6L3JlZ2lzdGVyP2FmZj1BVVhXOFc5Nk1XU0o=', ['生图', '邀请'], null, ['gpt'], '注册送Pro号池月卡4000积分（约60刀），据反馈可能已停送', '新站，注册就免费送一个Pro号池的月卡套餐，送4000积分约60刀左右，应急够用。每拉一位新用户可额外获得一张Pro月卡兑换码。模型以GPT为主，有5.4、5.5，速度很快。', 'unstable', false],
  ['GJX AI', 'aHR0cHM6Ly9hcGkuZ2p4ODguY29tL3JlZ2lzdGVyP2FmZj1FV0o0TFdTTU1ZQ1I=', ['生图', '邀请'], 1, ['gpt'], '注册即送50刀，GPT 5.2-5.5 + image-2 生图', '注册即送50刀，模型倍率1倍。主打GPT模型，5.2/5.3/5.4/5.5/image-2都有。渠道状态比较稳定，特意区分了文本渠道和生图渠道。', 'stable', false],
  ['Model Gate', 'aHR0cHM6Ly9tb2RlbGdhdGUuYXBwL3JlZ2lzdGVyP2FmZj1pUk5q', ['签到', '邀请'], 0.8, ['claude'], '注册送5刀，签到1-5刀/天，纯Claude号池', '注册送5刀，每天签到可得1-5刀不等。纯Claude号池，其中Claude MAX倍率0.8。不适合大量使用，偶尔应急不错。', 'stable', false],
  ['Ai-Router', 'aHR0cHM6Ly9haS1yb3V0ZXIuZGV2L3JlZ2lzdGVyP2FmZj1HNTU4TjNQWjgyM1E=', ['邀请'], null, ['gpt'], '注册得5刀（20刀需充值激活），只有 GPT 5.2-5.5', '非公益站，注册即可得20刀（据反馈实际5刀+15刀需充值激活），无签到。模型只有GPT，覆盖5.2-5.5。', 'stable', false],
  ['芙卡卡の小食堂', 'aHR0cHM6Ly9hcGkuZnVrYS53aW4vcmVnaXN0ZXI/YWZmPWxQRjA=', ['邀请'], null, ['claude', 'gpt', 'gemini', 'deepseek'], '注册得150点，大部分模型按次付费1-3点', '现在注册得150点，邀请好友各得50点，无签到功能。大部分模型是按次付费的，一次1-3点。模型比较丰富。', 'stable', false],
  ['可萌中转站', 'aHR0cHM6Ly9hcGk0NTYubWUvcmVnaXN0ZXI/YWZmPUJjY2o=', ['签到', '邀请'], null, ['claude', 'gpt', 'gemini', 'deepseek'], '注册送20硬币，按次扣费，可签到', '注册送20硬币，该站按次扣费。覆盖Claude、GPT、Gemini、DeepSeek、Kimi、智谱等多个大模型。可签到获得随机额度。', 'stable', false],
  ['Moyuu AI', 'aHR0cDovL21veXV1LmNjL3JlZ2lzdGVyP2FmZj1Tc3dv', ['签到', '生图', '邀请'], null, ['claude', 'gemini', 'gpt'], '公益站，注册送6刀，模型丰富含 gpt-image-2', '公益站，注册送6刀，签到也送。模型有Claude4.6-4.8、Gemini3-3.1、GPT5.4-5.5，而且有gpt-image-2。', 'stable', false],
  ['FreeModel', 'aHR0cHM6Ly9mcmVlbW9kZWwuZGV2L2ludml0ZS9GUkUtMjBkMjBkNDk=', ['邀请', '稳定'], null, [], '注册赠一个月Pro，每5小时10刀，需绑手机', '新用户注册赠送一个月Pro，可作为应急使用。每5小时可用10刀，每周66.67刀，每周二额度自动重置。需要绑定手机。', 'stable', false],
  ['api中转站', 'aHR0cHM6Ly96aG9uZ3podWFuemhhbi55c2hzaHMuY2MuY2Qvc2lnbi11cD9hZmY9YzFJWA==', [], null, ['gpt'], '注册送60（须邀请码），5.6sol 超低倍率，近期不稳', '注册送60必须邀请码，有5.6sol，超级低的倍率能用40亿。近期大拉闸，可能不稳，具体能否可用请自行查看。', 'unstable', false],
  ['Ben API', 'aHR0cHM6Ly9hcGkuYmVuemhvdXBvLnh5ei9zaWduLXVwP2FmZj1RTjBO', [], 0.0001, ['claude', 'gpt', 'grok'], '即将跑路，这几天全部0.0001倍率', '即将跑路，但这几天全部0.0001倍率，注册送0.05，能蹬很久！模型啥都有，Claude、ChatGPT、Grok等等。', 'unstable', false],
];

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '') || 'site';

const today = '2026-08-22';
const sites = [];
let featuredOrder = 1;
let normalOrder = 100;

for (const [name, b64, tags, multiplier, models, summary, description, status, featured] of RAW) {
  let url = Buffer.from(b64, 'base64').toString('utf-8');
  // 去掉推广参数（aff/code/invite 等是 FreeTokenNav 站长的推广码，保持中立去掉）
  url = url.split('?')[0];
  if (!/^https?:\/\//i.test(url)) {
    console.error('! invalid url for', name, url);
    continue;
  }
  sites.push({
    id: slug(name),
    name,
    url,
    multiplier,
    bonus: '',
    models,
    tags,
    summary,
    description,
    status,
    isFeatured: featured,
    sortOrder: featured ? featuredOrder++ : normalOrder++,
    verifiedAt: today,
    createdAt: today,
    updatedAt: today,
  });
}

fs.writeFileSync(OUT, JSON.stringify(sites, null, 2) + '\n', 'utf-8');
console.log(`✓ wrote ${sites.length} sites`);
console.log(`  featured: ${sites.filter(s => s.isFeatured).length}, stable: ${sites.filter(s => s.status === 'stable').length}, unstable: ${sites.filter(s => s.status === 'unstable').length}`);
