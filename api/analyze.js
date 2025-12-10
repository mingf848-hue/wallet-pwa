// --- A. Prompt: 去除平台判断，保持“所见即所得” ---
    const systemPrompt = `
      你是一个经验丰富、极其严谨的私人财务助理。你的任务是精准分析支付截图，提取交易数据。

      【核心原则：所见即所得】
      **严禁臆造数据。如果图片上写的是“一件也是批发价”，商户名就必须填“一件也是批发价”，绝对不要根据意思去联想或编造（如“有范生活”等）。**

      【字段提取规则】

      1. **merchant (商户/交易对象)**：
         - **OCR优先**：严格提取截图顶部或头像旁边的**可视文字**。
         - **禁止脑补**：即使商户名看起来像一句口号（例如“一件起批”、“外贸原单”），只要它是作为标题出现的，就直接提取原话。

      2. **product_name (备注)**：
         - **智能精简**：对于电商长标题，请务必【提炼核心商品名】。
         - 例如：将 "夏季爆款冰丝无痕大码女内裤防走光" 精简为 "冰丝无痕内裤"。
         - 去除："包邮"、"网红"、"显瘦" 等营销词汇。
      
      3. **category (分类)**：
         - 从 food, shop, transport, home, fun, other 中选一个最准确的。
      
      4. **date (日期)**：
         - **请务必从截图里提取日期和时间 (YYYY-MM-DD HH:mm:ss)**。如果截图里没有年份，默认 ${currentYear}。
         - 如果是列表，下方的交易必须继承上方最近的日期头。

      【判断与规则】
      
      类型 A：单笔订单详情页 -> 只返回 1 条汇总记录。
      类型 B：账单列表页 -> 返回多条记录。

      返回 JSON 示例：
      [
        {"amount": 135.03, "type": "expense", "merchant": "蜜雪冰城", "product_name": "生菜, 瓜子, 可乐...", "category": "food", "date": "2025-12-10 18:00:00"},
        {"amount": 4.89, "type": "expense", "merchant": "一件也是批发价", "product_name": "透明女士内裤", "category": "shop", "date": "2025-12-10 14:00:00"}
      ]
      不要使用 Markdown，直接返回纯 JSON 字符串。
    `;

    // ... (中间发起 fetch 请求的代码保持不变) ...

    // --- C. 核心逻辑：账户匹配 & 时间优先级 (已移除 item.platform 相关逻辑) ---
    for (const item of items) {
        let targetAcc = null;

        // 1. 优先使用前端传来的 manualPlatform (点击的那个按钮)
        if (manualPlatform && manualPlatform !== '自动识别') {
            const choice = manualPlatform.toLowerCase();
            targetAcc = currentState.accounts.find(a => a.name.toLowerCase().includes(choice) || a.id.toLowerCase().includes(choice));
            
            // 模糊匹配补充
            if (!targetAcc) {
                if (manualPlatform.includes('微信')) targetAcc = currentState.accounts.find(a => a.id.includes('wechat'));
                if (manualPlatform.includes('支付宝')) targetAcc = currentState.accounts.find(a => a.id.includes('alipay'));
            }
            // 银行卡兜底
            if (!targetAcc && (manualPlatform.includes('银行') || choice.includes('bank') || choice.includes('card'))) {
                 targetAcc = currentState.accounts.find(a => a.name.toLowerCase().includes('mashreq'));
                 if (!targetAcc) targetAcc = currentState.accounts.find(a => a.name.includes('银行') || a.name.toLowerCase().includes('bank'));
            }
        }

        // 2. 如果没有手动指定，或者手动指定没找到，尝试根据【商户名】匹配 (比如商户名包含 Mashreq)
        if (!targetAcc) {
            if (item.merchant && (item.merchant.toLowerCase().includes('mashreq') || item.merchant.toLowerCase().includes('bank'))) {
                targetAcc = currentState.accounts.find(a => a.name.toLowerCase().includes('mashreq'));
            }
        }

        // 3. 实在匹配不到，使用默认账户 (数组第一个)
        if (!targetAcc) targetAcc = currentState.accounts[0];

        const finalNote = item.product_name && item.product_name.length > 1 ? item.product_name : item.merchant;
        
        // ★★★ 核心逻辑：时间优先级判断 ★★★
        let finalTxDate = new Date(iphoneTime); 
        
        if (item.date) {
            let aiParsedDate = new Date(item.date);
            const currentMonth = new Date().getMonth(); 
            const isSuspiciousJan1 = aiParsedDate.getMonth() === 0 && aiParsedDate.getDate() === 1 && currentMonth > 1;

            if (!isNaN(aiParsedDate.getTime()) && aiParsedDate.getFullYear() >= 2024 && !isSuspiciousJan1) {
                 finalTxDate = aiParsedDate; 
            }
        }

        // 批量记账时，对时间戳进行倒序微调
        finalTxDate.setMilliseconds(finalTxDate.getMilliseconds() - timeOffset);
        timeOffset += 100;

        const newTx = {
            id: Date.now() - timeOffset + Math.random(), 
            type: item.type || 'expense',
            amount: parseFloat(item.amount),
            currency: targetAcc.currency || 'CNY',
            accountId: targetAcc.id,
            category: item.category || 'other', 
            date: finalTxDate.toISOString(),
            merchant: item.merchant, 
            note: finalNote
        };

        const accIndex = currentState.accounts.findIndex(a => a.id === targetAcc.id);
        if (accIndex !== -1) {
            if (newTx.type === 'expense') currentState.accounts[accIndex].balance -= newTx.amount;
            else currentState.accounts[accIndex].balance += newTx.amount;
        }
        
        currentState.transactions.push(newTx);
        successMsg.push(`${item.merchant} ${newTx.type==='income'?'+':'-'}${newTx.amount}`);
    }
