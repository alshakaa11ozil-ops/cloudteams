import dotenv from 'dotenv'
import path from 'path'
import { callGemini } from '../src/services/ai/gemini'

// Load .env from backend root
dotenv.config({ path: path.resolve(__dirname, '../.env') })

async function testAI() {
    console.log('--- AI Connection Test ---')
    console.log('Base URL:', process.env.AI_BASE_URL)
    console.log('Model:', process.env.AI_MODEL)

    try {
        const response = await callGemini('Say hello in one sentence.', 50)
        console.log('Response:', response)
        console.log('Status: SUCCESS ✅')
    } catch (error: any) {
        console.error('Status: FAILED ❌')
        console.error('Error:', error.message)
    }
}

testAI()
