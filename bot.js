const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const token = '7307573228:AAEZ-n22-KGt4OCx8TmwiQqjY4C7b0dKhoo';
const yandexApiKey = '3336a293-1de9-417d-8e5e-31288126061c';  // API ключ для Яндекс.Карт
const adminUsername = 'botiroffb';  // Имя пользователя администратора
const adminChatId = '349284259';

const bot = new TelegramBot(token, { polling: true });
const databaseFile = './database.json';

const states = {};
const ASK_ORIGIN = 'ASK_ORIGIN';
const ASK_DESTINATION = 'ASK_DESTINATION';
const BROADCAST_MESSAGE = 'BROADCAST_MESSAGE';
const BROADCAST_PHOTO = 'BROADCAST_PHOTO';
const CHANGE_STATUS = 'CHANGE_STATUS';
const VIEW_USER = 'VIEW_USER';

const mainMenu = {
  reply_markup: {
    keyboard: [
      [{ text: '🚖 Заказать такси' }],
      [{ text: 'ℹ️ Помощь' }]
    ],
    resize_keyboard: true,
    one_time_keyboard: true
  }
};

const adminMenu = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '👥 Пользователи', callback_data: 'users' }],
      [{ text: '📢 Рассылка', callback_data: 'broadcast' }],
      [{ text: '🚪 Выход из админки', callback_data: 'exit_admin' }]
    ]
  }
};

// Функция для чтения базы данных из JSON
function readDatabase() {
  if (!fs.existsSync(databaseFile)) {
    fs.writeFileSync(databaseFile, JSON.stringify({ users: [] }, null, 2));
  }
  const data = fs.readFileSync(databaseFile, 'utf8');
  return JSON.parse(data);
}

// Функция для записи базы данных в JSON
function writeDatabase(data) {
  fs.writeFileSync(databaseFile, JSON.stringify(data, null, 2), 'utf8');
}

// Функция для добавления или обновления пользователя в базе данных
function upsertUser(user) {
  const database = readDatabase();
  const existingUserIndex = database.users.findIndex(u => u.userId === user.userId);

  if (existingUserIndex === -1) {
    database.users.push(user);
  } else {
    const existingUser = database.users[existingUserIndex];
    existingUser.username = user.username;
    existingUser.trackingId = user.trackingId;
    if (!existingUser.invited_by && user.invited_by) {
      existingUser.invited_by = user.invited_by;
    }
  }

  writeDatabase(database);
  console.log('Database updated:', database);
}

// Функция для обновления лимита пользователя
function updateLimit(inviterId) {
  const database = readDatabase();
  const inviter = database.users.find(u => u.userId === inviterId);

  if (inviter) {
    inviter.limit_status = 1;
    writeDatabase(database);

    bot.sendMessage(inviter.userId, '🎉 Ваш лимит снят! Вы можете продолжать использовать бота без ограничений.');
    console.log(`Inviter ${inviter.username} limit status updated.`);
  } else {
    console.log(`Inviter with ID ${inviterId} not found.`);
  }
}

// Обработка команды /start и реферальной ссылки
bot.onText(/\/start(?:\s+(\d+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || 'undefined';
  const referredById = match[1] ? parseInt(match[1], 10) : null;

  console.log('Start command received:', { chatId, username, referredById });

  const database = readDatabase();
  let user = database.users.find(u => u.userId === chatId);

  if (!user) {
    user = {
      id: uuidv4(),
      username: username,
      userId: chatId,
      trackingId: uuidv4(),
      limit_status: 0,
      usage_count: 0,
      invited_by: referredById
    };

    upsertUser(user);

    if (referredById) {
      console.log(`Updating limit for inviter: ${referredById}`);
      updateLimit(referredById);
    }

    // Send notification to admin about the new user
    if (username !== 'undefined') {
      bot.sendMessage(adminChatId, `🔔 Новый пользователь: [@${username}](https://t.me/${username})`, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(adminChatId, `🔔 Новый пользователь: ID ${chatId}`);
    }

  } else {
    user.username = username;
    user.trackingId = uuidv4();
    if (!user.invited_by && referredById) {
      user.invited_by = referredById;
      console.log(`Updating limit for inviter: ${referredById}`);
      updateLimit(referredById);
    }

    upsertUser(user);
  }

  bot.sendMessage(chatId, 'Привет! Выберите действие из меню.', mainMenu);
});

bot.onText(/\/adminpanel/, (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || 'undefined';

  console.log('Admin panel command received:', { chatId, username });

  if (username !== adminUsername) {
    bot.sendMessage(chatId, 'У вас нет прав доступа к этой команде.');
    return;
  }

  const database = readDatabase();
  const inlineKeyboard = database.users.map(user => [{ text: `${user.username} (ID: ${user.id})`, callback_data: `view_user_${user.id}` }]);
  inlineKeyboard.push([{ text: '⬅️ Назад', callback_data: 'back_to_admin' }]);

  bot.sendMessage(chatId, '👥 Пользователи:', {
    reply_markup: {
      inline_keyboard: inlineKeyboard
    }
  });
});

bot.on('callback_query', (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const username = callbackQuery.from.username || 'undefined';

  console.log('Callback query received:', { chatId, username, data: callbackQuery.data });

  if (username !== adminUsername) {
    bot.sendMessage(chatId, 'У вас нет прав доступа к этой команде.');
    return;
  }

  const data = callbackQuery.data;
  const database = readDatabase();

  if (data.startsWith('view_user_')) {
    const userId = data.split('_')[2];
    const user = database.users.find(u => u.id === userId);

    if (user) {
      let response = `🆔 Детали пользователя ID: ${userId}\n`;
      response += `👤 Username: ${user.username}\n`;
      response += `🆔 User ID: ${user.userId}\n`;
      response += `📍 Tracking ID: ${user.trackingId}\n`;
      response += `🚫 Limit Status: ${user.limit_status ? 'No limit' : 'Limited'}\n`;
      response += `🔄 Usage Count: ${user.usage_count}\n`;
      response += `🧑‍🤝‍🧑 Invited By: ${user.invited_by || 'None'}\n`;

      const opts = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✏️ Изменить статус', callback_data: `change_status_${user.id}` }],
            [{ text: '⬅️ Назад к списку пользователей', callback_data: 'users' }]
          ]
        }
      };

      bot.editMessageText(response, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: opts.reply_markup
      });
    } else {
      bot.sendMessage(chatId, 'Пользователь не найден.');
    }
    return;
  }

  if (data.startsWith('change_status_')) {
    const userId = data.split('_')[2];
    states[chatId] = { type: CHANGE_STATUS, userId: userId };
    bot.sendMessage(chatId, 'Введите новый статус (0 - Limited, 1 - No limit):');
    return;
  }

  switch (data) {
    case 'broadcast':
      bot.editMessageText('Выберите тип рассылки:', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [
            [{ text: '📝 Текст', callback_data: 'broadcast_text' }],
            [{ text: '📸 Фото', callback_data: 'broadcast_photo' }],
            [{ text: '⬅️ Назад', callback_data: 'back_to_admin' }]
          ]
        }
      });
      break;
    case 'broadcast_text':
      states[chatId] = BROADCAST_MESSAGE;
      bot.sendMessage(chatId, 'Введите сообщение для рассылки:');
      break;
    case 'broadcast_photo':
      states[chatId] = BROADCAST_PHOTO;
      bot.sendMessage(chatId, 'Отправьте фото и добавьте подпись для рассылки:');
      break;
    case 'exit_admin':
      bot.editMessageText('Вы вышли из админки.', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: []
        }
      });
      bot.sendMessage(chatId, 'Выберите действие из меню.', mainMenu);
      break;
    case 'back_to_admin':
      bot.editMessageText('Админ-панель:', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: adminMenu.reply_markup
      });
      break;
    default:
      bot.sendMessage(chatId, 'Неизвестная команда.');
  }
});

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || 'undefined';

  console.log('Message received:', { chatId, username, text: msg.text });

  if (states[chatId] && states[chatId].type === CHANGE_STATUS) {
    const newStatus = parseInt(msg.text);
    if (isNaN(newStatus) || (newStatus !== 0 && newStatus !== 1)) {
      bot.sendMessage(chatId, 'Некорректный статус. Введите 0 для Limited или 1 для No limit.');
      return;
    }

    const database = readDatabase();
    const user = database.users.find(u => u.id === states[chatId].userId);
    if (user) {
      user.limit_status = newStatus;
      writeDatabase(database);
      bot.sendMessage(chatId, `Статус пользователя ID: ${user.id} обновлен на ${newStatus ? 'No limit' : 'Limited'}.`);
    } else {
      bot.sendMessage(chatId, 'Пользователь не найден.');
    }

    delete states[chatId];
    return;
  }

  if (states[chatId] === BROADCAST_MESSAGE) {
    if (username !== adminUsername) {
      bot.sendMessage(chatId, 'У вас нет прав доступа к этой команде.');
      return;
    }

    const broadcastMessage = msg.text;
    const database = readDatabase();

    database.users.forEach(user => {
      bot.sendMessage(user.userId, broadcastMessage);
    });

    bot.sendMessage(chatId, 'Сообщение отправлено всем пользователям.');

    delete states[chatId];
    return;
  }

  if (states[chatId] === BROADCAST_PHOTO) {
    if (username !== adminUsername) {
      bot.sendMessage(chatId, 'У вас нет прав доступа к этой команде.');
      return;
    }

    if (msg.photo) {
      const caption = msg.caption || '';
      const database = readDatabase();

      database.users.forEach(user => {
        bot.sendPhoto(user.userId, msg.photo[msg.photo.length - 1].file_id, { caption });
      });

      bot.sendMessage(chatId, 'Фото отправлено всем пользователям.');

      delete states[chatId];
      return;
    }
  }

  checkUsageLimit(chatId, () => {
    if (msg.text === '🚖 Заказать такси') {
      states[chatId] = ASK_ORIGIN;
      bot.sendMessage(chatId, '📍 Отправьте место отправления или нажмите "Мое местоположение"', {
        reply_markup: {
          keyboard: [
            [{ text: '📍 Мое местоположение', request_location: true }],
            [{ text: 'Отмена' }]
          ],
          resize_keyboard: true,
          one_time_keyboard: true
        }
      });
    } else if (msg.text === 'Отмена') {
      bot.sendMessage(chatId, 'Выберите действие из меню.', mainMenu);
    } else if (msg.text === 'ℹ️ Помощь') {
      const helpText = `📋 Инструкция по использованию:
1. Нажмите "🚖 Заказать такси".
2. Отправьте ваше местоположение как точку отправления.
3. Отправьте местоположение пункта назначения.
4. Получите ссылку для заказа такси.

Если у вас есть вопросы, нажмите кнопку "Тех поддержка".

🔔 Чтобы снять лимит, пригласите нового пользователя по своей реферальной ссылке.

🎥 Видеообучение: [Ссылка на видео]`;
      const opts = {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '💬 Тех поддержка',
                url: 'https://t.me/botiroffb'
              }
            ]
          ]
        }
      };
      bot.sendMessage(chatId, helpText, opts);
    } else if (states[chatId] === 'ASK_REFERRAL') {
      const referralUserId = msg.text;
      const database = readDatabase();
      const referralUser = database.users.find(u => u.userId === referralUserId);

      console.log('Referral attempt:', { referralUserId, referralUser });

      if (referralUser) {
        const user = database.users.find(u => u.userId === chatId);
        if (user) {
          user.limit_status = 1;
          user.invited_by = referralUserId;
          writeDatabase(database);
          bot.sendMessage(chatId, '🎉 Ваш лимит снят! Вы можете продолжать использовать бота без ограничений.');
        } else {
          bot.sendMessage(chatId, 'Пользователь не найден.');
        }
      } else {
        bot.sendMessage(chatId, 'Пользователь с таким ID не найден. Попробуйте снова.');
      }

      delete states[chatId];
    } else {
      const state = states[chatId];

      if (state === ASK_ORIGIN) {
        if (msg.location) {
          states[chatId] = ASK_DESTINATION;
          states[`${chatId}_origin`] = msg.location;
          bot.sendMessage(chatId, '📍 Теперь отправьте место назначения.');
        } else {
          bot.sendMessage(chatId, '📍 Пожалуйста, отправьте местоположение.');
        }
      } else if (state === ASK_DESTINATION) {
        if (msg.location) {
          const origin = states[`${chatId}_origin`];
          const destination = msg.location;
          const trackingId = uuidv4();

          const database = readDatabase();
          const user = database.users.find(u => u.userId === chatId);
          if (user) {
            user.usage_count += 1;
            user.trackingId = trackingId;
            writeDatabase(database);
          }

          const taxiUrl = `https://3.redirect.appmetrica.yandex.com/route?start-lat=${origin.latitude}&start-lon=${origin.longitude}&end-lat=${destination.latitude}&end-lon=${destination.longitude}&appmetrica_tracking_id=${trackingId}`;

          const opts = {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: '🚖 Заказать такси',
                    url: taxiUrl
                  }
                ]
              ]
            }
          };
          const advertisement = `🔔 Для размещения рекламы обращайтесь @botiroffb`;
          bot.sendPhoto(chatId, 'https://konstruktor.trafikbor.uz/yandex.png', {
            caption: `Вот ваша ссылка на Яндекс.Такси:\n\n${advertisement}`,
            reply_markup: opts.reply_markup
          });
          bot.sendMessage(chatId, 'Выберите действие из меню.', mainMenu);
          delete states[chatId];
          delete states[`${chatId}_origin`];
        } else if (msg.text) {
          const address = msg.text;
          axios.get('https://geocode-maps.yandex.ru/1.x/', {
            params: {
              apikey: yandexApiKey,
              format: 'json',
              geocode: address
            }
          }).then(response => {
            const geoObject = response.data.response.GeoObjectCollection.featureMember[0].GeoObject;
            const coordinates = geoObject.Point.pos.split(' ');
            const destination = {
              latitude: parseFloat(coordinates[1]),
              longitude: parseFloat(coordinates[0])
            };

            const origin = states[`${chatId}_origin`];
            const trackingId = uuidv4();

            const database = readDatabase();
            const user = database.users.find(u => u.userId === chatId);
            if (user) {
              user.usage_count += 1;
              user.trackingId = trackingId;
              writeDatabase(database);
            }

            const taxiUrl = `https://3.redirect.appmetrica.yandex.com/route?start-lat=${origin.latitude}&start-lon=${origin.longitude}&end-lat=${destination.latitude}&end-lon=${destination.longitude}&appmetrica_tracking_id=${trackingId}`;

            const opts = {
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: '🚖 Заказать такси',
                      url: taxiUrl
                    }
                  ]
                ]
              }
            };
            const advertisement = `🔔 Для размещения рекламы обращайтесь @botiroffb`;
            bot.sendPhoto(chatId, 'https://konstruktor.trafikbor.uz/yandex.png', {
              caption: `Вот ваша ссылка на Яндекс.Такси:\n\n${advertisement}`,
              reply_markup: opts.reply_markup
            });
            bot.sendMessage(chatId, 'Выберите действие из меню.', mainMenu);
            delete states[chatId];
            delete states[`${chatId}_origin`];
          }).catch(error => {
            console.error(error);
            bot.sendMessage(chatId, 'Не удалось найти указанный адрес. Попробуйте еще раз.');
          });
        } else {
          bot.sendMessage(chatId, '📍 Пожалуйста, отправьте местоположение или введите адрес.');
        }
      }
    }
  });
});

function checkUsageLimit(chatId, callback) {
  const database = readDatabase();
  const user = database.users.find(u => u.userId === chatId);

  if (user && user.limit_status === 0 && user.usage_count >= 2) {
    const referralLink = `https://t.me/yandextaxilocbot?start=${user.userId}`;
    const referralMessage = `🚫 Вы достигли лимита использования. Пригласите нового пользователя, чтобы продолжить.\n\n🔗 Ваша реферальная ссылка: ${referralLink}`;

    const opts = {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '📨 Пригласить пользователя',
              switch_inline_query: `Приглашаю тебя воспользоваться ботом для заказа такси! ${referralLink}`
            }
          ]
        ]
      }
    };

    bot.sendMessage(chatId, referralMessage, opts);
    states[chatId] = 'ASK_REFERRAL';
  } else {
    callback();
  }
}
