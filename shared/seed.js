// Fictional example data only. Existing online records are stored separately.
export const initialSettings = {
  name:'意淼小屋', subtitle:'把想念，放进同一个家', acquainted:'', relationship:'', nextMeeting:'',
  people:{yiting:{name:'成员 A',city:'',context:'',home:'',previous:'',avatar:''},haomiao:{name:'成员 B',city:'',context:'',home:'',previous:'',avatar:''}}
};
const ranges=[["2020-01-01","2020-01-04"],["2020-02-01","2020-02-05"],["2020-03-01","2020-03-04"],["2020-04-01","2020-04-03"],["2020-05-01","2020-05-05"],["2020-06-01","2020-06-04"],["2020-07-01","2020-07-04"],["2020-08-01","2020-08-02"],["2020-09-01","2020-09-03"],["2020-10-01","2020-10-04"],["2020-11-01","2020-11-03"],["2020-12-01","2020-12-03"],["2021-01-01","2021-01-02"],["2021-02-01","2021-02-02"]];
const numbers=['一','二','三','四','五','六','七','八','九','十','十一','十二','十三','十四'];
export const initialMeetings = ranges.map(([start,end],i)=>({id:`initial-${i+1}`,title:`示例见面${numbers[i]}`,start,end,place:'',story:''}));
