// ==============================
// DNS対策（VPS安定用）
// ==============================
const dns = require("node:dns");
dns.setDefaultResultOrder("ipv4first");

// ==============================
// 初期設定
// ==============================
require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
} = require("discord.js");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const INTRO_CHANNEL_ID = process.env.INTRO_CHANNEL_ID;

// ==============================
// Discord Client
// ==============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [
    Partials.Channel,
  ],
});

// ==============================
// 自己紹介案内
// ==============================
const INTRO_GUIDE_TEXT = [
  "## 自己紹介を書いてみて",
  "",
  "```txt",
  "【名前】：五条悟",
  "【年齢】：任意（書かなくてもOK）",
  "【性別】：任意（書かなくてもOK）",
  "【趣味】：任意（書かなくてもOK）",
  "```",
  "",
  "書けたら、VCに上がって `/eren list` を試してみて。",
  "エレンがいい感じに展開してくれるからさ。",
  "初対面でも話題に困りにくいでしょ。僕って親切。",
].join("\n");

// DM文面は後で調整
const WELCOME_DM_TEXT = [
  "やあ、アニメ世界観サーバーへようこそ。",
  "",
  "まずは自己紹介チャンネルを見てみて。",
  "テンプレートを使って自己紹介を書けば、みんなも話しかけやすくなるからさ。",
  "",
  "詳しい案内は、自己紹介チャンネルに置いてあるよ。",
].join("\n");

// チャンネルごとに直前の案内メッセージIDを記録
const lastGuideMessageIds = new Map();

// 同時投稿による案内の重複を防ぐ
const refreshLocks = new Map();

// ==============================
// 設定確認
// ==============================
function validateEnvironment() {
  const missing = [];

  if (!DISCORD_TOKEN) {
    missing.push("DISCORD_TOKEN");
  }

  if (!INTRO_CHANNEL_ID) {
    missing.push("INTRO_CHANNEL_ID");
  }

  if (missing.length > 0) {
    console.error(
      `❌ .envに設定されていません: ${missing.join(", ")}`
    );
    process.exit(1);
  }
}

// ==============================
// 自己紹介チャンネル取得
// ==============================
async function getIntroChannel() {
  try {
    const channel = await client.channels.fetch(INTRO_CHANNEL_ID);

    if (!channel || !channel.isTextBased()) {
      console.error(
        "❌ INTRO_CHANNEL_IDのチャンネルが見つからないか、テキストチャンネルではありません"
      );
      return null;
    }

    return channel;
  } catch (error) {
    console.error(
      "❌ 自己紹介チャンネルの取得に失敗:",
      error?.message ?? error
    );
    return null;
  }
}

// ==============================
// 古い案内を削除
// ==============================
async function deletePreviousGuides(channel) {
  const savedMessageId = lastGuideMessageIds.get(channel.id);

  if (savedMessageId) {
    try {
      const savedMessage = await channel.messages.fetch(savedMessageId);

      if (savedMessage) {
        await savedMessage.delete();
      }
    } catch {
      // すでに削除されている場合は無視
    } finally {
      lastGuideMessageIds.delete(channel.id);
    }
  }

  // Bot再起動前に残った案内も削除
  try {
    const messages = await channel.messages.fetch({
      limit: 100,
    });

    const oldGuides = messages.filter((message) => {
      return (
        message.author.id === client.user.id &&
        message.content === INTRO_GUIDE_TEXT
      );
    });

    for (const message of oldGuides.values()) {
      try {
        await message.delete();
      } catch (error) {
        console.error(
          "⚠️ 古い案内を削除できませんでした:",
          error?.message ?? error
        );
      }
    }
  } catch (error) {
    console.error(
      "⚠️ 過去メッセージの取得に失敗:",
      error?.message ?? error
    );
  }
}

// ==============================
// 案内を最下部へ更新
// ==============================
async function refreshIntroGuide(channel) {
  // 同じチャンネルでの処理を順番に実行する
  const previousTask =
    refreshLocks.get(channel.id) ?? Promise.resolve();

  const currentTask = previousTask
    .catch(() => {})
    .then(async () => {
      await deletePreviousGuides(channel);

      const sent = await channel.send({
        content: INTRO_GUIDE_TEXT,
        allowedMentions: {
          parse: [],
        },
      });

      lastGuideMessageIds.set(channel.id, sent.id);

      console.log(
        `📌 自己紹介案内を更新: ${channel.name} / ${channel.id}`
      );
    });

  refreshLocks.set(channel.id, currentTask);

  try {
    await currentTask;
  } finally {
    if (refreshLocks.get(channel.id) === currentTask) {
      refreshLocks.delete(channel.id);
    }
  }
}

// ==============================
// 起動時
// ==============================
client.once(Events.ClientReady, async (readyClient) => {
  console.log("=================================");
  console.log(`✅ Logged in as ${readyClient.user.tag}`);
  console.log(`📘 自己紹介チャンネル: ${INTRO_CHANNEL_ID}`);
  console.log("=================================");

  // 起動時にも案内を最新へ置き直す
  const introChannel = await getIntroChannel();

  if (introChannel) {
    await refreshIntroGuide(introChannel);
  }
});

// ==============================
// 新規参加者へDM
// ==============================
client.on(Events.GuildMemberAdd, async (member) => {
  if (member.user.bot) return;

  console.log(
    `👋 新規参加: ${member.user.tag} / ${member.user.id}`
  );

  try {
    await member.send({
      content: WELCOME_DM_TEXT,
      allowedMentions: {
        parse: [],
      },
    });

    console.log(`📨 DM送信成功: ${member.user.tag}`);
  } catch (error) {
    // ユーザーがDMを拒否している場合など
    console.log(
      `⚠️ DM送信失敗: ${member.user.tag} / ${error?.message ?? error}`
    );
  }
});

// ==============================
// 自己紹介チャンネル監視
// ==============================
client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;
    if (message.channelId !== INTRO_CHANNEL_ID) return;
    if (!message.channel.isTextBased()) return;

    await refreshIntroGuide(message.channel);
  } catch (error) {
    console.error(
      "❌ messageCreate error:",
      error?.message ?? error
    );
  }
});

// ==============================
// エラー処理
// ==============================
client.on(Events.Error, (error) => {
  console.error(
    "❌ Discord client error:",
    error
  );
});

process.on("unhandledRejection", (error) => {
  console.error(
    "❌ unhandledRejection:",
    error
  );
});

process.on("uncaughtException", (error) => {
  console.error(
    "❌ uncaughtException:",
    error
  );
});

// ==============================
// ログイン
// ==============================
validateEnvironment();

client.login(DISCORD_TOKEN);