# 零用金管理 V2：產品規格（測試版）

## 0. 版本定位與不可違反原則

本文件定義零用金管理 V2 的測試版規格，服務 1–2 人共同管理現金預支、支出、找零、延後補收據與盤點差異。

**V2 不得直接寫入正式資料、正式 Apps Script 或正式網址。** 測試環境必須使用獨立資料表、獨立 API 部署及明確標示的測試網址。只有完成本文件的驗收與發布閘門，且取得管理者明確同意，才可建立正式發布候選版本。

以下規則不得以便利為由例外：

1. 找零不是收入。找零只能歸屬於原預支紀錄，不能新增為收入流水。
2. 盤點不得調整帳面。它只比對、記錄與追查差異。
3. 預支與結清必須是同一筆主紀錄；每次異動另寫不可覆寫的稽核紀錄。
4. 前端、後端與資料表必須使用同一份資料契約；任一方不得自行推論欄位或重算另一套邏輯。
5. 不得未測試直接部署正式版；每次部署必須可回復。

## 1. 使用者流程與底部選單

底部固定四個入口：

| 選單 | 目的 | 首層內容 |
|---|---|---|
| 首頁 | 看現況與待辦 | 帳面現金、未結清預支、待補收據、盤點差異、最近紀錄 |
| 操作 | 新增現金動作 | 取款／預支、直接支出、補入零用金、盤點 |
| 紀錄 | 查詢與後續處理 | 全部、未結清、待補收據、已結清、盤點／調整、月結 |
| 設定 | 管理基本資料與規則 | 公司、期初金額、經手人、用途分類、憑證規則、權限 |

「結清」是點入原預支紀錄後的動作，不是主選單；「月結」是紀錄內的查核功能；「盤點」是操作中的管理行為。

每次記錄最多三步：

1. 選擇動作或原預支單。
2. 填寫必要金額、用途、經手人與憑證狀態。
3. 顯示計算結果後確認送出。

## 2. 資料契約

所有 API 回傳、寫入請求與資料表欄位皆以本契約為準。金額一律是非負整數（最小貨幣單位）；日期使用 `YYYY-MM-DD`；時間使用 ISO 8601；所有查詢及寫入必須附帶 `companyId`。

### 2.1 現金主紀錄 `CashTransaction`

```ts
type TransactionType = 'advance' | 'direct_expense' | 'replenishment' | 'adjustment';
type CashStatus = 'draft' | 'open' | 'settling' | 'settled' | 'discrepancy_pending' | 'voided';
type ReceiptStatus = 'not_required' | 'pending' | 'submitted' | 'verified' | 'rejected';

interface CashTransaction {
  id: string;
  companyId: string;
  transactionType: TransactionType;
  transactionDate: string;
  amount: number;              // 預支、直接支出、補入或調整原始金額
  purpose: string;
  handlerId: string;
  cashStatus: CashStatus;
  actualExpense: number | null; // 僅預支結清時填入
  returnedCash: number | null;  // 僅預支結清時填入；不是收入
  receiptStatus: ReceiptStatus;
  receiptReference: string | null;
  settledAt: string | null;
  settledBy: string | null;
  adjustmentReason: string | null;
  requestId: string;           // 防止網路重送建立重複紀錄
  revision: number;            // 防止同時結清／覆寫
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}
```

約束：

- `advance` 建立後 `cashStatus=open`、`actualExpense=null`、`returnedCash=null`。
- `direct_expense`、`replenishment` 建立後即為 `settled`。
- `adjustment` 只能由管理者建立，必填 `adjustmentReason` 與附件／說明。
- 找零只可寫在 `returnedCash`；禁止以 `replenishment` 或收入類型代替。
- 已送出的主紀錄不可刪除，只能作廢或建立更正／調整，並寫入稽核軌跡。

### 2.2 盤點紀錄 `CashCount`

```ts
type CountStatus = 'open' | 'explained' | 'resolved';

interface CashCount {
  id: string;
  companyId: string;
  countedAt: string;
  countedBy: string;
  ledgerCash: number;  // 建立盤點當下的帳面快照
  actualCash: number;  // 實點現金
  difference: number;  // actualCash - ledgerCash
  reason: string | null;
  status: CountStatus;
  evidence: string | null;
  createdAt: string;
}
```

`CashCount` 的建立、修改或結案不得改變任何 `CashTransaction`，也不得改變帳面現金。

### 2.3 稽核紀錄 `AuditLog`

每一筆新增、結清、修改、作廢、調整與盤點結案都必須產生一筆不可覆寫的紀錄：

```ts
interface AuditLog {
  id: string;
  companyId: string;
  entityType: 'transaction' | 'cash_count';
  entityId: string;
  action: 'create' | 'settle' | 'edit' | 'void' | 'adjust' | 'resolve_count';
  before: object | null;
  after: object;
  reason: string | null;
  actorId: string;
  createdAt: string;
}
```

## 3. 狀態機

### 3.1 預支現金狀態

```text
draft → open → settling → settled
                   └────→ discrepancy_pending → settled（僅經正式調整或補正）
任一未月結紀錄 ───────────────────────────────→ voided
```

- `open`：現金已取出，尚未完成結清；必須列入未結清待辦。
- `settling`：結清資料輸入中，僅客戶端暫態，不可被當成已結清。
- `settled`：符合結清公式，現金流程完成。
- `discrepancy_pending`：預支、實支、找零不相等；不可被隱藏、不可自動補差。
- `voided`：保留原始紀錄與原因；不得直接刪除。

### 3.2 憑證狀態（獨立於現金狀態）

```text
not_required
pending → submitted → verified
                 └──→ rejected → submitted
```

現金已結清但 `receiptStatus=pending` 時，首頁顯示「待補收據」，但不得再把該筆列入未結清預支或改動現金餘額。

## 4. 帳務公式與判斷

### 4.1 帳面現金

```text
帳面現金 = 期初現金
          + Σ(補入零用金)
          + Σ(已結清預支之找零)
          - Σ(直接支出)
          - Σ(所有有效預支金額)
          + Σ(正式調整單)
```

其中：

- 有效預支指 `cashStatus` 為 `open`、`settled` 或 `discrepancy_pending` 的 `advance`。
- 預支建立時即扣除原始預支金額；結清時只加回 `returnedCash`，不得再扣除 `actualExpense`。
- `actualExpense` 用於驗證與費用分析，不直接再影響現金公式。
- 找零不得列入收入、收入摘要或補入零用金。
- 盤點差額永遠不進入上述公式。

### 4.2 預支結清公式

```text
預支金額 = 實支金額 + 找零金額
```

只有精確相等時才允許轉為 `settled`。不相等時：

- 寫入 `discrepancy_pending`；
- 首頁及紀錄頁都顯示差額；
- 不得自動建立收入、支出、找零或調整；
- 管理者需建立可稽核的正式調整單，或更正原始資料並保留稽核紀錄。

### 4.3 盤點公式

```text
盤點差額 = 實點現金 - 建立盤點時的帳面現金
```

短少為負數、溢收為正數。盤點只能發現差異與建立追查工作，不是入帳動作。

## 5. API 行為

### 5.1 必要端點

| API | 行為 | 必要防呆 |
|---|---|---|
| `GET /home?companyId=` | 回傳單一公司首頁彙總與待辦 | 一次讀取完成彙總；不得重複掃描相同流水 |
| `POST /transactions` | 新增預支、直接支出、補入或調整 | 驗證角色、欄位、`requestId` 去重、寫入稽核 |
| `POST /transactions/{id}/settle` | 結清原預支單 | 驗證 `revision`、結清公式、權限，更新同筆主紀錄並新增稽核 |
| `GET /transactions` | 查詢與篩選紀錄 | 公司隔離、狀態篩選、不可混算 |
| `POST /cash-counts` | 建立盤點 | 讀取帳面快照，不得寫入調整 |
| `POST /cash-counts/{id}/resolve` | 註記盤點差異追查結果 | 不得更改帳面；若需入帳，另建正式調整單 |

### 5.2 寫入成功條件

API 僅在主紀錄、必要稽核紀錄及資料驗證都成功後回傳成功。回傳內容至少包括：

```ts
{ success: true, transaction: CashTransaction, ledgerCash: number, requestId: string }
```

前端收到成功後先立即更新該筆畫面與提示，再以單一背景請求刷新首頁彙總；不得因儲存後同步重讀首頁、未結清、盤點、月結等多份全量資料而阻塞使用者。

### 5.3 權限

- 操作人可新增紀錄、結清本人預支、補本人收據。
- 管理者可結清他人預支、建立調整單、覆核盤點、管理設定與月結。
- 一般操作人不得刪除紀錄、直接調整帳面或解除月結。
- 所有 API 以登入身分判斷權限，前端隱藏按鈕不構成權限控制。

## 6. 驗收案例

| 案例 | 輸入 | 預期結果 |
|---|---|---|
| 全數找零 | 預支 1,000；實支 0；找零 1,000 | 帳面先減 1,000、結清後加回 1,000；沒有收入紀錄 |
| 一般結清 | 預支 1,000；實支 800；找零 200 | 帳面最終淨減 800；同一預支單顯示已結清 |
| 無找零 | 預支 1,000；實支 1,000；找零 0 | 帳面淨減 1,000；結清成功 |
| 結清不符 | 預支 1,000；實支 800；找零 150 | 不可已結清，顯示差額 50 並進入待處理 |
| 延後收據 | 預支 1,000；實支 1,000；收據待補 | 現金已結清；首頁列待補收據；帳面不變動 |
| 直接支出 | 直接支出 360 | 帳面減 360；不產生未結清預支 |
| 補入零用金 | 補入 15,000 | 帳面加 15,000；不被列為收入或找零 |
| 盤點短少 | 帳面 10,000；實點 9,900 | 顯示差額 -100；帳面仍為 10,000 |
| 公司隔離 | A、B 各建立一筆 | 餘額、待辦、紀錄皆完全隔離 |
| 重複送出 | 同一 `requestId` 重送 | 只產生一筆主紀錄與一筆建立稽核 |
| 併發結清 | 兩人用同一 revision 結清 | 只有第一筆成功；第二筆收到版本衝突並重新載入 |

## 7. 測試、速度與發布門檻

### 7.1 測試資料隔離

- 測試版必須使用獨立資料庫／試算表與獨立部署識別，不得連到正式資料來源。
- 測試資料需含上述所有情境，但不得使用正式帳務可識別資料；若需匯入，先去識別化並標記為測試。
- 正式版資料只允許唯讀備份作為回復依據，不能當作 V2 寫入測試對象。

### 7.2 速度門檻

- 一般新增、結清、盤點 API 在測試資料規模下，95% 回應時間小於 2 秒。
- 前端儲存成功後 300 毫秒內顯示完成或背景同步提示，不等待大型首頁全量查詢。
- 首頁 API 對同一次請求只讀取一次交易資料並重用彙總結果；禁止首頁、警示、對帳各自重新掃描同一份流水。
- 任何逾時、重試或離線重送都必須保持 `requestId` 去重。

### 7.3 上線閘門

以下條件全部成立前，**禁止部署正式版**：

1. 單元測試覆蓋帳面公式、找零分類、狀態轉換、公司隔離、請求去重與版本衝突。
2. 本規格第 6 節所有驗收案例在測試資料中逐項通過，並保留結果。
3. 前端、API、資料表依資料契約做整合測試，無欄位或枚舉不一致。
4. 實機完成四項人工流程：預支、結清、待補收據、盤點。
5. 速度門檻通過，並確認儲存後未發生重複大查詢。
6. 已建立正式資料備份、已指定回復部署版本、已演練回復。
7. 管理者明確確認測試版畫面、金額與流程後，才可建立發布候選。
8. 發布後先使用新的測試紀錄驗證，確認無誤才恢復正式記帳。

