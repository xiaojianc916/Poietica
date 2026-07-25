use std::fmt;

// keyring 4 exposes the platform-independent entry through its v1 module; the
// crate root only holds the module tree.
use keyring::v1::{Entry, Error as KeyringError};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::error::{Result, StoreError};

/// Credential store service the key is filed under.
pub const KEY_SERVICE: &str = "poietica";

/// Credential store account the key is filed under.
pub const KEY_ACCOUNT: &str = "ai-store";

const KEY_BYTES: usize = 32;

/// A raw SQLCipher key.
///
/// A raw key is used rather than a passphrase, which means SQLCipher performs
/// no key derivation when opening the database. Deriving a key from a
/// passphrase would cost hundreds of thousands of PBKDF2 rounds on every open
/// and add nothing, because the material already has full entropy.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct DatabaseKey([u8; KEY_BYTES]);

impl fmt::Debug for DatabaseKey {
    /// Never renders the key material, so it cannot reach a log by accident.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DatabaseKey(redacted)")
    }
}

impl DatabaseKey {
    /// Generates a key from the thread-local CSPRNG, which is seeded and
    /// periodically reseeded from the operating system entropy source.
    #[must_use]
    pub fn generate() -> Self {
        Self(rand::random())
    }

    /// Rebuilds a key from stored hexadecimal.
    ///
    /// # Errors
    ///
    /// Fails when the text is not hexadecimal or does not decode to 32 bytes.
    pub fn from_hex(text: &str) -> Result<Self> {
        let decoded = hex::decode(text)?;

        let bytes: [u8; KEY_BYTES] = decoded
            .as_slice()
            .try_into()
            .map_err(|_ignored| StoreError::KeyLength(decoded.len()))?;

        Ok(Self(bytes))
    }

    /// Renders the key for the SQLCipher pragma.
    #[must_use]
    pub fn to_hex(&self) -> String {
        hex::encode(self.0)
    }

    /// Reads the key from the credential store, creating one on first run.
    ///
    /// # Errors
    ///
    /// Fails when the credential store is unavailable or holds unusable
    /// material.
    pub fn load_or_create(service: &str, account: &str) -> Result<Self> {
        let entry = Entry::new(service, account)?;

        // The error enum is non-exhaustive, so the wildcard arm is required.
        match entry.get_password() {
            Ok(stored) => Self::from_hex(&stored),
            Err(KeyringError::NoEntry) => {
                let key = Self::generate();
                entry.set_password(&key.to_hex())?;
                Ok(key)
            }
            Err(other) => Err(other.into()),
        }
    }
}
