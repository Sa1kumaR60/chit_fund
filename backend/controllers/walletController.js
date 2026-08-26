const db = require("../db");
const { recordAuditLog } = require("../utils/auditLog");
const dbPromise = db.promise();

const getWalletDetails = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const [[wallet]] = await dbPromise.query("SELECT * FROM wallets WHERE user_id = ?", [userId]);

    if (!wallet) {
      return res.status(404).json({ message: "Wallet not found" });
    }

    const [transactions] = await dbPromise.query(
      "SELECT * FROM transactions WHERE wallet_id = ? ORDER BY created_at DESC",
      [wallet.wallet_id]
    );

    return res.status(200).json({
      wallet,
      transactions,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const addFunds = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { amount, description = "Added funds to wallet" } = req.body;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    const connection = await dbPromise.getConnection();
    await connection.beginTransaction();

    try {
      const [[wallet]] = await connection.query("SELECT * FROM wallets WHERE user_id = ? FOR UPDATE", [userId]);

      if (!wallet) {
        throw new Error("Wallet not found");
      }

      await connection.query("UPDATE wallets SET balance = balance + ? WHERE wallet_id = ?", [amount, wallet.wallet_id]);
      
      await connection.query(
        `INSERT INTO transactions (wallet_id, amount, type, description) VALUES (?, ?, 'DEPOSIT', ?)`,
        [wallet.wallet_id, amount, description]
      );

      await recordAuditLog(connection, {
        userId,
        actionType: "WALLET_DEPOSIT",
        referenceType: "SYSTEM",
        details: {
          amount: Number(amount),
          description,
        },
      });

      await connection.commit();
      
      const [[updatedWallet]] = await dbPromise.query("SELECT * FROM wallets WHERE user_id = ?", [userId]);
      return res.status(200).json({ message: "Funds added successfully", wallet: updatedWallet });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getWalletDetails,
  addFunds,
};
