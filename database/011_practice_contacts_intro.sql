-- Migration 011: Track when the advisor completes the practice-contacts learning step
-- Run after 010_onboarding_tiers.sql

ALTER TABLE user_subscriptions
  ADD COLUMN IF NOT EXISTS practice_contacts_intro_at TIMESTAMPTZ;

COMMENT ON COLUMN user_subscriptions.practice_contacts_intro_at IS
  'Set when the user adds practice clients via the contacts onboarding action — counts toward setup completion';
