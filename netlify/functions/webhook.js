// netlify/functions/webhook.js

export async function handler(event, context) {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
  const GEMINI_API_KEY = process.env.API_KEY; // مفتاح API الخاص بنموذج Gemini

  // ✅ التحقق من فيسبوك
  if (event.httpMethod === "GET") {
    const params = event.queryStringParameters;
    if (params["hub.verify_token"] === VERIFY_TOKEN) {
      return {
        statusCode: 200,
        body: params["hub.challenge"],
      };
    }
    return { statusCode: 403, body: "Forbidden" };
  }

  // ✅ التعامل مع الرسائل والـ postbacks الواردة
  if (event.httpMethod === "POST") {
    const body = JSON.parse(event.body);

    if (body.object === "page") {
      for (const entry of body.entry) {
        const webhookEvent = entry.messaging[0];
        const senderId = webhookEvent.sender.id;

        if (webhookEvent.message) {
          const userMsg = webhookEvent.message.text ? webhookEvent.message.text.trim().toLowerCase() : '';
          
          console.log("📩 رسالة المستخدم:", userMsg);
          
          if (userMsg) {
              await getGeminiResponseAndSend(senderId, userMsg, GEMINI_API_KEY, PAGE_ACCESS_TOKEN);
          }
        } else if (webhookEvent.postback && webhookEvent.postback.payload === "GET_STARTED_PAYLOAD") {
            // 🔄 تحديث: رسالة ترحيبية عامة واجتماعية
            const welcomeText = "أهلاً بك! 👋 أنا مساعدك الشخصي الجديد. يمكنك سؤالي عن أي موضوع يخطر ببالك، سواء كان اجتماعياً، ثقافياً، أو مجرد دردشة ودية!";
            await sendMessage(senderId, welcomeText, PAGE_ACCESS_TOKEN);
        }
      }
      return { statusCode: 200, body: "EVENT_RECEIVED" };
    }
    return { statusCode: 404, body: "Not Found" };
  }

  return { statusCode: 405, body: "Method Not Allowed" };
}

// 🔹 دالة للحصول على رد من نموذج Gemini وإرساله
async function getGeminiResponseAndSend(senderId, userPrompt, apiKey, token) {
  const maxRetries = 3;
  let response = null;

  // 🔄 تحديث: توجيه النموذج ليصبح مساعداً عاماً/اجتماعياً
  const systemPrompt = "أنت مساعد اجتماعي وودي، مهمتك هي إجراء محادثات ممتعة ومفيدة حول مواضيع متنوعة. حافظ على لهجة دافئة، مرحبة، وقريبة من المستخدم. يمكنك تقديم معلومات، إجابات على أسئلة عامة، أو ببساطة الدردشة. تجاوب مع الأسئلة المفتوحة بلباقة وحماس. استخدم تنسيق Markdown بذكاء لتمييز النقاط الرئيسية.";

  const payload = {
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    }
  };

  for (let i = 0; i < maxRetries; i++) {
    try {
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

      response = await fetch(apiUrl, {
        method: 'POST',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        break;
      }

      if (response.status === 503 && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000;
        console.log(`API returned 503, retrying in ${delay / 1000} seconds...`);
        await new Promise(res => setTimeout(res, delay));
      } else {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error('API call failed:', error);
      if (i === maxRetries - 1) {
        throw error;
      }
    }
  }

  if (response && response.ok) {
    try {
      const result = await response.json();
      let botResponse = result?.candidates?.[0]?.content?.parts?.[0]?.text || 'عذرًا، لم أتمكن من العثور على إجابة. يرجى المحاولة مرة أخرى.';
      
      // ✅ الحل: إزالة تنسيقات Markdown قبل الإرسال (ضروري لـ Messenger)
      botResponse = botResponse.replace(/\*\*(.*?)\*\*/g, '$1'); // إزالة الخط العريض
      botResponse = botResponse.replace(/\*(.*?)\*/g, '$1');     // إزالة الخط المائل
      botResponse = botResponse.replace(/^- /, '• ');             // تحويل القائمة النقطية

      await sendMessage(senderId, botResponse, token);
    } catch (jsonError) {
      console.error('JSON parsing error:', jsonError);
      await sendMessage(senderId, 'عذرًا، كانت هناك مشكلة في معالجة الاستجابة من الخادم.', token);
    }
  } else {
    await sendMessage(senderId, 'عذرًا، حدث خطأ أثناء الاتصال. يرجى التحقق من مفتاح API أو المحاولة لاحقًا.', token);
  }
}

// 🔹 دالة لإرسال رسالة نصية عادية
async function sendMessage(senderId, text, token) {
  await fetch(`https://graph.facebook.com/v16.0/me/messages?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: senderId },
      message: { text },
    }),
  });
}
