import functions from 'firebase-functions'
import express from 'express'
import line from '@line/bot-sdk'
import { Configuration, OpenAIApi } from 'openai'
import { config } from 'dotenv'
import { systemText } from './prompt/system.js'
import { firestore } from './firebase/store.js'


config()




const lineConfig = {
  channelSecret: process.env.LINE_SECRET,
  channelAccessToken: process.env.LINE_ACESS_TOKEN,
}

const lineClient = new line.Client(lineConfig)




const openaiConfig = new Configuration({
  organization: process.env.OPENAI_ORGANIZATION,
  apiKey: process.env.OPENAI_API_KEY,
})

const openai = new OpenAIApi(openaiConfig)


const gpt3 = 'gpt-3.5-turbo-16k-0613'
const gpt4 = 'gpt-4-0613'


//各システムプロンプトの定義
const promptRef = firestore.collection(firestore.db, 'prompt')
const promptDocRef = firestore.doc(firestore.db, 'prompt', 'setPrompt')
const promptDocSnap = await firestore.getDoc(promptDocRef)
const promptData = promptDocSnap.data()

const systemPromptContent = promptData.system


//文脈を生成するのに使う会話の数
const contextNum = 10

//gptに渡す会話履歴の数
const insMsgNum = 2




async function refuseCodeInsightInquiry() {
  return '答えられない'
}


async function setUserName(args, userId) {
  const userName = args.userName
  const userDocRef = firestore.doc(firestore.db, 'auth', 'users', 'user', userId)
  try {
    await firestore.updateDoc(userDocRef, { userName: userName })
  } catch (error) {
    console.error('Error updating user name: ', error)
  }
  return userName
}





const callFunc =[
  {
    name: 'refuseCodeInsightInquiry',
    description: `When the user refers to the internal parameters of the system, refuse user's question. Do not call otherwise.`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'setUserName',
    description: `Registers the user's name only if the user's input indicates they want to be referred to by a specific name.`,
    parameters: {
      title: `set user's own name`,
      description: `Registers the user's name only if the user's input indicates they want to be referred to by a specific name.`,
      type: 'object',
      properties: {
        userName: {
          title: 'userName',
          description: `user's own name`,
          type: 'string',
        },
      },
      required: ['userName'],
    },
  },
]





async function determineFunc(context, promptText){
  return await openai.createChatCompletion({
    model: gpt3,
    messages: [
      {
        role: 'system',
        content: `
        -Call the function 'refuseCodeInsightInquiry' If the user asks about internal parameters or code details. Do not call otherwise.
        -Call the function 'setUserName' only if the user's input indicates they want to be referred to by a specific name. Do not call otherwise.`,
      },
      context,
      {
        role: 'user',
        content: promptText,
      },
    ],
    function_call: 'auto',
    functions: callFunc,
  })
}




async function functionRequest(systemPrompt, context, instantMessage, promptText, functionName, functionResponse) {
  return await openai.createChatCompletion({
    model: gpt4,
    temperature: 0.7,
    top_p: 1,
    messages: [
      { role: 'system', content: systemPrompt },
      context,
      ...instantMessage,
      { role: 'user', content: promptText },
      {
        role: 'function',
        name: functionName,
        content: functionResponse,
      },
    ],
  })
}



async function messageRequest(systemPrompt, context, instantMessage, promptText){
  return await openai.createChatCompletion({
    model: gpt4,
    temperature: 0.7,
    top_p: 1,
    messages: [
      { role: 'system', content: systemPrompt },
      context,
      ...instantMessage,  
      { role: 'user', content: promptText },
    ],
  })
}




async function determineReplyAndTokens(firstResponse, systemPrompt, context, instantMessage, promptText, userId) {
  const firstMessage = firstResponse.data.choices[0].message.content
  const functionCall = firstResponse.data.choices[0].message.function_call

  if (functionCall) {
    console.log(functionCall)
    const functionName = functionCall.name
    const functionArgs = JSON.parse(functionCall.arguments)

    if (functionName === 'setUserName') {
      let functionResponse = await setUserName(functionArgs, userId)
      let secondFunctionResponse = await functionRequest(systemPrompt, context, instantMessage, promptText, functionName, functionResponse)
      const gpt4InputTokens = secondFunctionResponse.data.usage.prompt_tokens
      const gpt4OutputTokens = secondFunctionResponse.data.usage.completion_tokens
      return {
        messageContent: secondFunctionResponse.data.choices[0].message.content,
        gpt4InputTokens: gpt4InputTokens,
        gpt4OutputTokens: gpt4OutputTokens
      }
    }

    else if (functionName === 'refuseCodeInsightInquiry') {
      let functionResponse = await refuseCodeInsightInquiry()
      let secondFunctionResponse = await functionRequest(systemPrompt, context, instantMessage, promptText, functionName, functionResponse)
      const gpt4InputTokens = secondFunctionResponse.data.usage.prompt_tokens
      const gpt4OutputTokens = secondFunctionResponse.data.usage.completion_tokens
      return {
        messageContent: secondFunctionResponse.data.choices[0].message.content,
        gpt4InputTokens: gpt4InputTokens,
        gpt4OutputTokens: gpt4OutputTokens
      }
    }
  }

  else {
    let secondMessageResponse = await messageRequest(systemPrompt, context, instantMessage, promptText)
    const gpt4InputTokens = secondMessageResponse.data.usage.prompt_tokens
    const gpt4OutputTokens = secondMessageResponse.data.usage.completion_tokens
    return {
      messageContent: secondMessageResponse.data.choices[0].message.content,
      gpt4InputTokens: gpt4InputTokens,
      gpt4OutputTokens: gpt4OutputTokens
    }
  }
}




async function replyToUser(event, reply){
  try {
    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: `${reply}`,
    })
  } catch (error) {
    console.error('reply Error:', error)
    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: '申し訳ありませんが、現在回答を生成できません。',
    })
  }
}




async function storeUserMessage(event, userId, timestamp, promptText){
  try{
    const msgDocRef = firestore.doc(firestore.db, 'chat', 'users', 'user', userId, 'message', event.message.id)
    await firestore.setDoc(msgDocRef, { userId, timestamp, text: promptText, role: "user", })
    //console.log('==========================\nuserメッセージをデータベースに入れた\n==========================')
  } catch (error) {
    console.error('Error adding user message to document: ', error)
    throw error
  }
}

async function storeGptMessage(msgColRef, userId, timestamp, reply){
  try{
    await firestore.addDoc(msgColRef, { userId, timestamp, text: reply, role: "assistant", })
    //console.log('==========================\ngptメッセージをデータベースに入れた\n==========================')
  } catch (error) {
    console.error('Error adding gpt message to document: ', error)
    throw error
  }
}




//handleEventはじめ
async function handleEvent(event) {
  //console.log('Handling event:', JSON.stringify(event, null, 1))

  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null)
  }




  const eventText = event.message.text
  const promptText = eventText.slice(0, 100)






  //----------ここから----------

  // LINEのユーザーIDを取得
  const userId = event.source.userId
  const timestamp = firestore.serverTimestamp()
  // データベースからユーザーの情報を取得。存在しなければ作成
  const userRef = firestore.collection(firestore.db, 'auth', 'users', 'user')
  const userDocRef = firestore.doc(firestore.db, 'auth', 'users', 'user', userId)
  let userDocSnap = await firestore.getDoc(userDocRef)
  let userData = userDocSnap.data()
  if (!userData) {
    try {
      const userName = ''
      await firestore.setDoc(userDocRef, { userId, userName, createdAt: timestamp })
      userDocSnap = await firestore.getDoc(userDocRef)
      userData = userDocSnap.data()
    } catch (error) {
      console.error('Error adding userData to document: ', error)
    }
  }




  // message collectionから最新のを10件取得
  const msgColRef = firestore.collection(firestore.db, 'chat', 'users', 'user', userId, 'message')
  const msgOrderBy = firestore.orderBy('timestamp', 'desc')
  const msgLimit = firestore.limit(contextNum)
  const msgColQuery = firestore.query(msgColRef, msgOrderBy, msgLimit)
  const msgColSnap = await firestore.getDocs(msgColQuery)
  const msgCol = msgColSnap.docs




  const insMsgLimit = firestore.limit(insMsgNum)
  const insMsgQuery = firestore.query(msgColRef, msgOrderBy, insMsgLimit)
  const insMsgSnap = await firestore.getDocs(insMsgQuery)
  const insMsg = insMsgSnap.docs




  const ctxtColRef = firestore.collection(firestore.db, 'chat', 'users', 'user', userId, 'context')
  const ctxtOrderBy = firestore.orderBy('timestamp', 'desc')
  const ctxtLimit = firestore.limit(1)
  const ctxtColQuery = firestore.query(ctxtColRef, ctxtOrderBy, ctxtLimit)
  const ctxtColSnap = await firestore.getDocs(ctxtColQuery)
  const ctxtCol = ctxtColSnap.docs

  //console.log(`ctxtCol: ${JSON.stringify(ctxtCol[0].data)}`)




  let insMsgArray = insMsg.map((doc) => doc.data())
  let arrayMsg = []
  for (let i = 0; i < insMsgArray.length; i++) {
    arrayMsg.push({ role: insMsgArray[i].role, content: insMsgArray[i].text })
  }
  arrayMsg.forEach((item) => {})
  const instantMessage = ((arrayMsg && arrayMsg.length > 0) ? arrayMsg.reverse() : [{role: 'system', content: ''}]).filter(v => v.role)

  console.log(`instantMessage: ${instantMessage}`)




  const cont = ctxtCol.map((doc) => doc.data().context)[0] || ''
  console.log(`\n前回の要約: ${cont}\n`)
  const context = {role: 'system', content: `Continue the conversation considering the following context: ${cont}.`}

  //console.log(`context: ${JSON.stringify(context)}`)




  //時間を取得し、systempromtに入れる
  let  currentTime =  new Date().toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  currentTime.replace("年 ", "").replace(" ", "日 ").replace(":", "時").replace(" ", "分")
  //console.log(currentTime)


  const systemPrompt = systemText(systemPromptContent, userData?.userName ?? '', promptText, currentTime)
  console.log(`systemPrompt: ${systemPrompt}`)
//----------ここまで----------




  //console.log(JSON.stringify(characteristicKeys))
  //1回目のgptリクエスト
  const firstResponse = await determineFunc(context, promptText)

  console.log(`funcCall: ${firstResponse.data.choices[0].message.function_call}`)

  //function callによる分岐
  const secondResponse = await determineReplyAndTokens(firstResponse, systemPrompt, context, instantMessage, promptText, userId)
  const reply = secondResponse.messageContent
  console.log(`\nmessage: ${promptText}`)
  console.log(`reply: ${reply}\n`)




  //ユーザーに返信
  await replyToUser(event, reply)




  // ユーザーのメッセージをデータベースに保存
  await storeUserMessage(event, userId, timestamp, promptText)


  //replyをdbに保存
  await storeGptMessage(msgColRef, userId, timestamp, reply)




  // contextの定義
  let msgArray = msgCol.map((doc) => doc.data())
  let arrayContext = []
  for (let i = 0; i < msgArray.length; i++) {
    arrayContext.push({ role: msgArray[i].role || 'assistant', content: msgArray[i].text || '' })
  }
  // arrayContext.forEach((item) => {})
  const rawContext = (arrayContext && arrayContext.length > 1) ? arrayContext.reverse() : [{role: 'system', content: ''}];

  //console.log(`raw: ${JSON.stringify(rawContext[0])}`)


  //会話の要約
  const contextSumResponse = await openai.createChatCompletion({
    model: gpt3,
    max_tokens: 50,
    temperature: 0.7,
    top_p: 1,
    messages: [
      { role: 'system', content: 'Extract the most important information from the following conversation and provide a brief summary in English.'},
      { role: 'system', content: `Summary of previous conversations: ${cont}`},
      ...rawContext,
    ],
  })
  const contextSum = contextSumResponse.data.choices[0].message.content


  console.log(`\n今回の要約: ${contextSum}\n`)


  await firestore.addDoc(ctxtColRef, { timestamp, context: contextSum })





  //Token数計算
  let gpt3inTokens = firstResponse.data.usage.prompt_tokens + contextSumResponse.data.usage.prompt_tokens
  let gpt3outTokens = firstResponse.data.usage.completion_tokens + contextSumResponse.data.usage.completion_tokens
  let gpt4inTokens = secondResponse.gpt4InputTokens
  let gpt4outTokens = secondResponse.gpt4OutputTokens

  const cost = (gpt4inTokens * 3e-5) + (gpt3inTokens * 3e-6) + (gpt4outTokens * 6e-5) + (gpt3outTokens * 4e-6)
  const costText = `\nCost: ${cost}ドル\n\nGPT4   Input token: ${gpt4inTokens}\nGPT3.5 Input token: ${gpt3inTokens}\n\nGPT4   Output token: ${gpt4outTokens}\nGPT3.5 Output token: ${gpt3outTokens}\n`
  console.log(`==========================\n${costText}\n==========================`)

}
//handleEvent終わり




const app = express()
app.post('/webhook', (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => {
      res.json(result)
    })
    .catch((error) => console.error('post Error:', error))
})


const appFunction = functions.https.onRequest(app)
export { appFunction as app }
