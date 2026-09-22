require("fs").appendFileSync("C:/Users/saiku/OneDrive/Desktop/chit_fund/qa_tmp/logs/hb2.txt", "start|");
setInterval(() => require("fs").appendFileSync("C:/Users/saiku/OneDrive/Desktop/chit_fund/qa_tmp/logs/hb2.txt", "x"), 1000);
