import { aiChat } from '../../libs/ai-provider.js';
import { fetchWithTimeout, extractJson, getLanguageName } from '../../libs/http.js';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

async function humanizeText(env, text) {
  if (!env.DEVTOOLS_DEAI_KEY || !text || text.length < 20) return text;
  try {
    const response = await fetchWithTimeout('https://deai.029101.xyz/humanize', {
      method: 'POST',
      headers: { 'X-API-Key': env.DEVTOOLS_DEAI_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, mode: 'balanced', multi_run: 1, adversarial: false, wait: true })
    }, 45000);
    if (!response.ok) return text;
    const data = await response.json();
    if (data && data.result && typeof data.result === 'string') return data.result;
    return text;
  } catch (e) {
    return text;
  }
}

function buildSystemPrompt(language, audience, goal, level, duration) {
  const langName = getLanguageName(language);
  return 'You are a senior instructional designer and curriculum developer who builds complete, pedagogically sound courses.\n\nYou will design ONE complete course as a single structured JSON response.\n\nCOURSE FIELDS (use exactly these top-level keys):\n- title: string. Course title.\n- description: string. 2-3 sentence course description. No fluff. Accurate. Output in ' + langName + '.\n- level: string. One of "beginner" | "intermediate" | "advanced".\n- audience: string. Who it is for.\n- goal: string. The learning outcome the course is meant to produce.\n- learning_objectives: array of 3-6 strings. Measurable objectives. Output in ' + langName + '.\n- modules: array of modules. Each module: { module_title, module_description?, lessons: array of lessons }. Each lesson: { lesson_title, lesson_objectives: array, key_points: array of 3-6 strings, quiz_questions: array of { question, answer } }.\n- estimated_total_minutes: number. Total duration estimate.\n- quiz_pass_criteria: string. How the final quiz is passed.\n\nCRITICAL OUTPUT FORMAT:\nReturn ONLY a valid JSON object (no markdown fences, no preamble, no explanations). Use these top-level keys exactly: title, description, level, audience, goal, learning_objectives, modules, estimated_total_minutes, quiz_pass_criteria.\n\nQUALITY RULES:\n- Content must be accurate and non-speculative. Do not fabricate facts about real people, companies, or events.\n- Quizzes must have 2-5 questions per lesson with correct answers and brief explanations.\n- Order modules and lessons logically (foundational -> advanced).\n- estimated_total_minutes must be a positive number.\n- All human-readable text fields in ' + langName + '.';
}

function buildUserPrompt(input) {
  const lines = [];
  lines.push('Course Topic: ' + input.topic);
  if (input.audience) lines.push('Audience: ' + input.audience);
  if (input.goal) lines.push('Learning Goal: ' + input.goal);
  if (input.level) lines.push('Level: ' + input.level);
  if (input.duration) lines.push('Target Duration: ' + input.duration);
  if (input.language && input.language !== 'en') lines.push('Output Language: ' + getLanguageName(input.language));
  lines.push('');
  lines.push('Design the complete course now. Return only the JSON object.');
  return lines.join('\n');
}

function fallbackCourse(topic, audience, goal, level, duration) {
  const t = topic;
  const aud = audience || 'the intended audience';
  const course = {
    title: t + ' - Complete Course',
    description: 'A complete course covering ' + t + ' for ' + aud + '. Designed with clear learning objectives, sequenced modules, practical lessons and assessments.',
    level: level || 'beginner',
    audience: aud,
    goal: goal || 'master the fundamentals and apply them confidently.',
    learning_objectives: [
      'Explain the core concepts of ' + t + '.',
      'Apply the key techniques to real scenarios.',
      'Evaluate results and iterate.'
    ],
    modules: [
      {
        module_title: 'Module 1: Foundations of ' + t,
        lessons: [
          {
            lesson_title: 'Lesson 1: Introduction to ' + t,
            lesson_objectives: ['Define the scope of ' + t + '.'],
            key_points: ['Core terminology and concepts of ' + t + '.', 'Why the fundamentals matter.'],
            quiz_questions: [
              { question: 'What is the primary focus of ' + t + '?', answer: 'Understanding the fundamentals before advanced practice.' }
            ]
          }
        ]
      },
      {
        module_title: 'Module 2: Core Practices',
        lessons: [
          {
            lesson_title: 'Lesson 2: Applied ' + t,
            lesson_objectives: ['Apply core practices of ' + t + '.'],
            key_points: ['Step-by-step application of the core practices.', 'Common mistakes and how to avoid them.'],
            quiz_questions: [
              { question: 'What is the first step when starting with ' + t + '?', answer: 'Master the foundational concepts first.' }
            ]
          }
        ]
      }
    ],
    estimated_total_minutes: 60,
    quiz_pass_criteria: 'Score 80% or higher on the final quiz covering all modules.'
  };
  return { course: course, deai_used: false };
}

export async function onRequest(context) {
  const headers = Object.assign({}, CORS_HEADERS);
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers });
  }
  try {
    if (context.request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
    }
    const body = await context.request.json();
    const topic = (body.topic || '').toString().trim();
    const input = {
      topic: topic,
      audience: body.audience ? body.audience.toString().trim() : '',
      goal: body.goal ? body.goal.toString().trim() : '',
      level: body.level ? body.level.toString().trim() : '',
      duration: body.duration ? body.duration.toString().trim() : '',
      language: body.language ? body.language.toString().trim() : 'en'
    };

    if (!input.topic) {
      return new Response(JSON.stringify({ error: 'topic is required (20+ chars minimum)' }), { status: 422, headers });
    }
    if (input.topic.length < 20) {
      return new Response(JSON.stringify({ error: 'topic must be at least 20 characters' }), { status: 422, headers });
    }

    const fallback = fallbackCourse(input.topic, input.audience, input.goal, input.level, input.duration);
    let aiProvider = null;
    let aiError = null;
    let course = null;
    try {
      const ai = await aiChat(context.env, {
        messages: [
          { role: 'system', content: buildSystemPrompt(input.language, input.audience, input.goal, input.level, input.duration) },
          { role: 'user', content: buildUserPrompt(input) }
        ],
        temperature: 0.7,
        max_tokens: 4096
      });
      aiProvider = ai.provider;
      try {
        const parsed = extractJson(ai.content);
        if (parsed && typeof parsed === 'object') {
          course = parsed.course && typeof parsed.course === 'object' ? parsed.course : parsed;
        }
      } catch (parseErr) {
        aiError = 'AI JSON parse error: ' + parseErr.message;
      }
    } catch (e) {
      aiError = e.message;
    }

    const courseObj = course || fallback.course;
    const humanizedDescription = await humanizeText(context.env, courseObj.description || '');
    if (humanizedDescription !== (courseObj.description || '')) {
      courseObj.description = humanizedDescription;
    }

    const quizAnswers = [];
    const collectQuizAnswers = (modules) => {
      if (!Array.isArray(modules)) return;
      for (const m of modules) {
        if (!Array.isArray(m.lessons)) continue;
        for (const l of m.lessons) {
          if (!Array.isArray(l.quiz_questions)) continue;
          for (const q of l.quiz_questions) {
            if (q && typeof q.answer === 'string' && q.answer.length >= 20) quizAnswers.push(q.answer);
          }
        }
      }
    };
    collectQuizAnswers(courseObj.modules);
    for (const answer of quizAnswers) {
      const humanized = await humanizeText(context.env, answer);
      if (humanized !== answer) {
        const idx = quizAnswers.indexOf(answer);
        quizAnswers[idx] = humanized;
      }
    }

    const result = { course: courseObj, quiz_answers: quizAnswers };
    return new Response(JSON.stringify({
      course: courseObj,
      quiz_answers: quizAnswers,
      provider: aiProvider,
      deai_used: Boolean(context.env.DEVTOOLS_DEAI_KEY),
      ai_error: aiError
    }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
