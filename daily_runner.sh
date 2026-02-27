#!/bin/bash
# ============================================================
# ATM CRM Daily Runner
# ============================================================
# Chains: Gmail Sync → Notification Scan → Daily Digest Email
#
# SETUP:
#   1. Place all scripts in ~/Desktop/atm_enricher/
#   2. Set environment variables (see below)
#   3. Install cron job
#
# CRON SETUP (run at 7:00 AM ET every day):
#   crontab -e
#   Then add:
#   0 7 * * * cd ~/Desktop/atm_enricher && ./daily_runner.sh >> ~/Desktop/atm_enricher/logs/daily.log 2>&1
#
# For Gmail sync every 30 minutes (optional):
#   */30 * * * * cd ~/Desktop/atm_enricher && python3 gmail_sync.py >> ~/Desktop/atm_enricher/logs/sync.log 2>&1
#
# ENVIRONMENT VARIABLES (add to ~/.zshrc or ~/.bash_profile):
#   export RESEND_API_KEY=re_xxxxx
#   export ANTHROPIC_API_KEY=sk-ant-xxxxx
#   export SUPABASE_URL=https://wgrmxhxozoyvcmvbfuxv.supabase.co
#   export SUPABASE_KEY=your-service-role-key
#   export DIGEST_RECIPIENTS=john@atmbrokerage.com,jeff@atmbrokerage.com
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Create logs directory
mkdir -p logs

echo "============================================================"
echo "  ATM CRM DAILY RUN — $(date)"
echo "============================================================"

# Step 1: Sync Gmail (pull new emails from both inboxes)
echo ""
echo ">>> STEP 1: Gmail Sync"
python3 gmail_sync.py --days 1 2>&1 | tee -a logs/sync.log

# Step 2: Run daily digest (scans for notifications + sends email)
echo ""
echo ">>> STEP 2: Daily Digest"
python3 daily_digest.py 2>&1 | tee -a logs/digest.log

echo ""
echo "============================================================"
echo "  DAILY RUN COMPLETE — $(date)"
echo "============================================================"
