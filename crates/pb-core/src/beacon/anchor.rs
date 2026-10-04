//! Anchored selection round (Spec Section 8.1.1).
//!
//! Without an anchor every server derives the selection round from its own
//! `registered_at`, so servers that straddle a beacon tick disagree. With an
//! anchor the client names an already public round R inside the signed beacon
//! reference and every server uses round `R + ANCHOR_SELECTION_DELAY`.
//!
//! The rule that keeps this safe is enforced at registration: the selection
//! round must not be available yet. A server that receives the commitment too
//! late must reject it instead of selecting with known randomness.

use super::drand;

/// Selection round = `anchor_round + ANCHOR_SELECTION_DELAY`.
pub const ANCHOR_SELECTION_DELAY: u64 = 2;

/// The selection round must lie at least this far after `registered_at`.
/// Covers a server clock that runs slow relative to the beacon.
pub const ANCHOR_SELECTION_SAFETY_MARGIN_MS: i64 = 1_000;

/// An anchor round may start at most this far after `registered_at`.
/// Covers a server clock that runs slow relative to the client.
pub const ANCHOR_CLOCK_SKEW_ALLOWANCE_MS: i64 = 1_000;

/// Why an anchored commitment is refused at registration.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnchorRejection {
    /// Not a usable round number (zero, or too large for round arithmetic).
    InvalidRound,
    /// The anchor round has not been published yet.
    AnchorInFuture,
    /// The selection round is already available, or too close to be safe.
    SelectionRoundAvailable,
}

impl AnchorRejection {
    /// Stable machine-readable code, used as the API `error_code`.
    pub fn code(&self) -> &'static str {
        match self {
            AnchorRejection::InvalidRound => "anchor_round_invalid",
            AnchorRejection::AnchorInFuture => "anchor_round_in_future",
            AnchorRejection::SelectionRoundAvailable => "anchor_selection_round_available",
        }
    }

    pub fn message(&self) -> &'static str {
        match self {
            AnchorRejection::InvalidRound =>
                "beacon.anchor_round must be a positive integer round number",
            AnchorRejection::AnchorInFuture =>
                "beacon.anchor_round has not been published yet",
            AnchorRejection::SelectionRoundAvailable =>
                "selection round (anchor_round + 2) is already available or too close; \
                 re-sign with a fresh anchor_round",
        }
    }
}

/// Round → Unix time in milliseconds. `None` if the round is zero or the
/// arithmetic would overflow.
pub fn round_time_ms(round: u64) -> Option<i64> {
    if round == 0 {
        return None;
    }
    let offset = i64::try_from(round - 1).ok()?
        .checked_mul(drand::QUICKNET_PERIOD as i64)?;
    drand::QUICKNET_GENESIS.checked_add(offset)?.checked_mul(1000)
}

/// Selection round for an anchored commitment. `None` if `anchor_round` is
/// not a usable round number.
pub fn selection_round(anchor_round: u64) -> Option<u64> {
    if anchor_round == 0 {
        return None;
    }
    let round = anchor_round.checked_add(ANCHOR_SELECTION_DELAY)?;
    round_time_ms(round)?;
    Some(round)
}

/// Registration rule for an anchored commitment. Returns the selection round
/// when the commitment may be registered at `registered_at_ms`.
///
/// Both must hold:
/// - the anchor round is not in the future:
///   `round_time(anchor_round) <= registered_at + ANCHOR_CLOCK_SKEW_ALLOWANCE_MS`
/// - the selection round is not yet available:
///   `round_time(anchor_round + 2) > registered_at + ANCHOR_SELECTION_SAFETY_MARGIN_MS`
pub fn check_registration(anchor_round: u64, registered_at_ms: i64) -> Result<u64, AnchorRejection> {
    let selection = selection_round(anchor_round).ok_or(AnchorRejection::InvalidRound)?;
    let anchor_ms = round_time_ms(anchor_round).ok_or(AnchorRejection::InvalidRound)?;
    let selection_ms = round_time_ms(selection).ok_or(AnchorRejection::InvalidRound)?;

    if anchor_ms > registered_at_ms.saturating_add(ANCHOR_CLOCK_SKEW_ALLOWANCE_MS) {
        return Err(AnchorRejection::AnchorInFuture);
    }
    if selection_ms <= registered_at_ms.saturating_add(ANCHOR_SELECTION_SAFETY_MARGIN_MS) {
        return Err(AnchorRejection::SelectionRoundAvailable);
    }
    Ok(selection)
}

/// Parse an RFC 3339 timestamp (`2026-02-06T14:30:00.500Z`, with optional
/// fraction and `Z` or `+hh:mm` offset) to Unix milliseconds. Fractions finer
/// than a millisecond are truncated.
pub fn parse_rfc3339_ms(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 20 || !s.is_ascii() {
        return None;
    }
    let num = |from: usize, to: usize| -> Option<i64> {
        let part = s.get(from..to)?;
        if part.is_empty() || !part.bytes().all(|c| c.is_ascii_digit()) {
            return None;
        }
        part.parse::<i64>().ok()
    };
    if b[4] != b'-' || b[7] != b'-' || (b[10] != b'T' && b[10] != b't') || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let (year, month, day) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (hour, minute, second) = (num(11, 13)?, num(14, 16)?, num(17, 19)?);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day)
        || hour > 23 || minute > 59 || second > 60 {
        return None;
    }

    let mut pos = 19;
    let mut millis = 0i64;
    if b[pos] == b'.' {
        let start = pos + 1;
        let mut end = start;
        while end < b.len() && b[end].is_ascii_digit() {
            end += 1;
        }
        if end == start {
            return None;
        }
        let mut scale = 100;
        for &digit in &b[start..end.min(start + 3)] {
            millis += (digit - b'0') as i64 * scale;
            scale /= 10;
        }
        pos = end;
    }

    let offset_secs = match *b.get(pos)? {
        b'Z' | b'z' if pos + 1 == b.len() => 0,
        sign @ (b'+' | b'-') if pos + 6 == b.len() && b[pos + 3] == b':' => {
            let (oh, om) = (num(pos + 1, pos + 3)?, num(pos + 4, pos + 6)?);
            if oh > 23 || om > 59 {
                return None;
            }
            let secs = oh * 3600 + om * 60;
            if sign == b'+' { secs } else { -secs }
        }
        _ => return None,
    };

    // Days since 1970-01-01 for a proleptic Gregorian date.
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;

    let secs = days * 86_400 + hour * 3600 + minute * 60 + second - offset_secs;
    Some(secs * 1000 + millis)
}

#[cfg(test)]
mod tests {
    use super::*;

    const R: u64 = 25_892_262;

    fn t(round: u64) -> i64 {
        round_time_ms(round).unwrap()
    }

    #[test]
    fn delay_is_two() {
        assert_eq!(ANCHOR_SELECTION_DELAY, 2);
        assert_eq!(selection_round(R), Some(R + 2));
    }

    #[test]
    fn round_time_ms_matches_seconds() {
        assert_eq!(round_time_ms(1), Some(drand::QUICKNET_GENESIS * 1000));
        assert_eq!(round_time_ms(R), Some(drand::round_time(R) * 1000));
        assert_eq!(round_time_ms(0), None);
        assert_eq!(round_time_ms(u64::MAX), None);
    }

    #[test]
    fn accepts_current_anchor() {
        // Registered anywhere inside the anchor round's own period.
        assert_eq!(check_registration(R, t(R)), Ok(R + 2));
        assert_eq!(check_registration(R, t(R) + 2_999), Ok(R + 2));
    }

    #[test]
    fn accepts_previous_round_anchor_until_margin() {
        // Anchor R, registered during round R+1: selection round R+2 is still ahead.
        assert_eq!(check_registration(R, t(R + 1)), Ok(R + 2));
        assert_eq!(
            check_registration(R, t(R + 2) - ANCHOR_SELECTION_SAFETY_MARGIN_MS - 1),
            Ok(R + 2)
        );
    }

    #[test]
    fn rejects_inside_safety_margin() {
        assert_eq!(
            check_registration(R, t(R + 2) - ANCHOR_SELECTION_SAFETY_MARGIN_MS),
            Err(AnchorRejection::SelectionRoundAvailable)
        );
        assert_eq!(
            check_registration(R, t(R + 2) - 1),
            Err(AnchorRejection::SelectionRoundAvailable)
        );
    }

    #[test]
    fn rejects_when_selection_round_available() {
        assert_eq!(check_registration(R, t(R + 2)), Err(AnchorRejection::SelectionRoundAvailable));
        assert_eq!(check_registration(R, t(R + 100)), Err(AnchorRejection::SelectionRoundAvailable));
    }

    #[test]
    fn rejects_future_anchor() {
        assert_eq!(
            check_registration(R, t(R) - ANCHOR_CLOCK_SKEW_ALLOWANCE_MS - 1),
            Err(AnchorRejection::AnchorInFuture)
        );
        assert_eq!(check_registration(R + 1000, t(R)), Err(AnchorRejection::AnchorInFuture));
    }

    #[test]
    fn allows_small_clock_skew_on_anchor() {
        assert_eq!(
            check_registration(R, t(R) - ANCHOR_CLOCK_SKEW_ALLOWANCE_MS),
            Ok(R + 2)
        );
    }

    #[test]
    fn rejects_unusable_rounds_without_panicking() {
        assert_eq!(check_registration(0, t(R)), Err(AnchorRejection::InvalidRound));
        assert_eq!(check_registration(u64::MAX, t(R)), Err(AnchorRejection::InvalidRound));
        assert_eq!(check_registration(u64::MAX - 2, t(R)), Err(AnchorRejection::InvalidRound));
        assert_eq!(check_registration(R, i64::MAX), Err(AnchorRejection::SelectionRoundAvailable));
        assert_eq!(check_registration(R, i64::MIN), Err(AnchorRejection::AnchorInFuture));
    }

    #[test]
    fn same_selection_round_on_both_sides_of_a_tick() {
        // Two servers register the same anchored commitment just before and
        // just after the tick of round R+1. Unanchored they would disagree.
        let before = t(R + 1) - 200;
        let after = t(R + 1) + 200;
        assert_ne!(
            drand::next_round_after(before / 1000),
            drand::next_round_after(after / 1000)
        );
        assert_eq!(check_registration(R, before), Ok(R + 2));
        assert_eq!(check_registration(R, after), Ok(R + 2));
    }

    #[test]
    fn error_codes_are_stable() {
        assert_eq!(AnchorRejection::InvalidRound.code(), "anchor_round_invalid");
        assert_eq!(AnchorRejection::AnchorInFuture.code(), "anchor_round_in_future");
        assert_eq!(AnchorRejection::SelectionRoundAvailable.code(), "anchor_selection_round_available");
    }

    #[test]
    fn parse_rfc3339() {
        assert_eq!(parse_rfc3339_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_rfc3339_ms("2023-08-23T15:09:27Z"), Some(drand::QUICKNET_GENESIS * 1000));
        assert_eq!(parse_rfc3339_ms("2023-08-23T15:09:27.250Z"), Some(drand::QUICKNET_GENESIS * 1000 + 250));
        assert_eq!(parse_rfc3339_ms("2023-08-23T15:09:27.5Z"), Some(drand::QUICKNET_GENESIS * 1000 + 500));
        assert_eq!(parse_rfc3339_ms("2023-08-23T15:09:27.123456Z"), Some(drand::QUICKNET_GENESIS * 1000 + 123));
        assert_eq!(parse_rfc3339_ms("2023-08-23T17:09:27+02:00"), Some(drand::QUICKNET_GENESIS * 1000));
        assert_eq!(parse_rfc3339_ms("2023-08-23T10:09:27-05:00"), Some(drand::QUICKNET_GENESIS * 1000));
        assert_eq!(parse_rfc3339_ms("2024-02-29T00:00:00Z"), Some(1_709_164_800_000));
    }

    #[test]
    fn parse_rfc3339_rejects_garbage() {
        for bad in ["", "now", "2026-02-06", "2026-02-06T14:30:00", "2026-13-06T14:30:00Z",
                    "2026-02-06T14:30:00.Z", "2026-02-06 14:30:00Z", "2026-02-06T14:30:00Zjunk",
                    "2026-02-06T14:30:00+0200", "2026-02-06T25:30:00Z"] {
            assert_eq!(parse_rfc3339_ms(bad), None, "{bad}");
        }
    }
}
