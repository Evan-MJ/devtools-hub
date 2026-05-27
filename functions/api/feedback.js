export async function onRequestGet(context) {
    const FEEDBACK_KEY = 'feedback_list';
    
    try {
        const feedbackList = await context.env.FEEDBACK_KV.get(FEEDBACK_KEY, 'json');
        const feedback = feedbackList || [];
        
        feedback.sort((a, b) => {
            if (a.resolved !== b.resolved) {
                return a.resolved ? 1 : -1;
            }
            return new Date(b.timestamp) - new Date(a.timestamp);
        });
        
        return new Response(JSON.stringify(feedback), {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache'
            }
        });
    } catch (e) {
        return new Response(JSON.stringify([]), {
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

export async function onRequestPost(context) {
    const FEEDBACK_KEY = 'feedback_list';
    
    try {
        const body = await context.request.json();
        const { category, type, description, email, tool } = body;
        
        if (!category || !type || !description) {
            return new Response(JSON.stringify({ error: 'Missing required fields' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        const feedbackList = await context.env.FEEDBACK_KV.get(FEEDBACK_KEY, 'json') || [];
        
        const newFeedback = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
            category,
            tool: tool || 'Other',
            type,
            description: description.substring(0, 2000),
            email: email || '',
            resolved: false,
            timestamp: new Date().toISOString()
        };
        
        feedbackList.unshift(newFeedback);
        
        if (feedbackList.length > 100) {
            feedbackList.length = 100;
        }
        
        await context.env.FEEDBACK_KV.put(FEEDBACK_KEY, JSON.stringify(feedbackList));
        
        return new Response(JSON.stringify({ success: true, id: newFeedback.id }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

export async function onRequestPatch(context) {
    const FEEDBACK_KEY = 'feedback_list';
    const { searchParams } = new URL(context.request.url);
    const adminSecret = searchParams.get('admin_secret');
    const expectedSecret = context.env.FEEDBACK_ADMIN_SECRET || 'devtools-hub-admin-2026';
    
    if (adminSecret !== expectedSecret) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    
    try {
        const body = await context.request.json();
        const { id, resolved, adminNote, delete: shouldDelete } = body;
        
        if (!id) {
            return new Response(JSON.stringify({ error: 'Missing feedback ID' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        const feedbackList = await context.env.FEEDBACK_KV.get(FEEDBACK_KEY, 'json') || [];
        
        if (shouldDelete) {
            const filtered = feedbackList.filter(f => f.id !== id);
            await context.env.FEEDBACK_KV.put(FEEDBACK_KEY, JSON.stringify(filtered));
            return new Response(JSON.stringify({ success: true, deleted: true }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        const feedback = feedbackList.find(f => f.id === id);
        
        if (!feedback) {
            return new Response(JSON.stringify({ error: 'Feedback not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        if (resolved !== undefined) {
            feedback.resolved = resolved;
        }
        if (adminNote !== undefined) {
            feedback.adminNote = adminNote.substring(0, 500);
        }
        feedback.updatedAt = new Date().toISOString();
        
        await context.env.FEEDBACK_KV.put(FEEDBACK_KEY, JSON.stringify(feedbackList));
        
        return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

export async function onRequestDelete(context) {
    const FEEDBACK_KEY = 'feedback_list';
    const { searchParams } = new URL(context.request.url);
    const adminSecret = searchParams.get('admin_secret');
    const expectedSecret = context.env.FEEDBACK_ADMIN_SECRET || 'devtools-hub-admin-2026';
    
    if (adminSecret !== expectedSecret) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    
    try {
        const { id } = await context.request.json();
        
        if (!id) {
            return new Response(JSON.stringify({ error: 'Missing feedback ID' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        const feedbackList = await context.env.FEEDBACK_KV.get(FEEDBACK_KEY, 'json') || [];
        const filtered = feedbackList.filter(f => f.id !== id);
        
        await context.env.FEEDBACK_KV.put(FEEDBACK_KEY, JSON.stringify(filtered));
        
        return new Response(JSON.stringify({ success: true, deleted: true }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
