import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

export async function POST(request) {
  try {
    const { email_id } = await request.json();
    if (!email_id) return Response.json({ error: 'email_id required' }, { status: 400 });

    // Update status to pending_review so gmail_draft_push.py picks it up
    const SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const SK = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const res = await fetch(`${SB}/rest/v1/atm_activity_log?id=eq.${email_id}`, {
      method: 'PATCH',
      headers: {
        apikey: SK,
        Authorization: `Bearer ${SK}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ draft_status: 'pending_review' }),
    });

    if (!res.ok) throw new Error('Supabase update failed');

    // Run the Python push script for this specific email
    const cwd = path.join(process.cwd());
    const { stdout, stderr } = await execAsync(
      `python3 gmail_draft_push.py --email-id ${email_id}`,
      { cwd, timeout: 30000 }
    );

    console.log('Push output:', stdout);
    if (stderr) console.error('Push stderr:', stderr);

    // Check if it succeeded by re-fetching the record
    const check = await fetch(
      `${SB}/rest/v1/atm_activity_log?id=eq.${email_id}&select=draft_status,draft_gmail_id`,
      { headers: { apikey: SK, Authorization: `Bearer ${SK}` } }
    );
    const [record] = await check.json();

    if (record?.draft_status === 'pushed_to_gmail') {
      return Response.json({
        success: true,
        gmail_link: `https://mail.google.com/mail/u/0/#drafts`,
        draft_gmail_id: record.draft_gmail_id,
      });
    } else {
      return Response.json({ success: false, error: 'Push may have failed', output: stdout });
    }

  } catch (err) {
    console.error('Push route error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
