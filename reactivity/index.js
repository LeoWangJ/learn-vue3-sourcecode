const bucket = new WeakMap()

let activeEffect
const effectStack = []
const triggerType = {
  SET:'SET',
  ADD:'ADD',
  DELETE:'DELETE'
}
function effect (fn,options = {}){
  const effectFn = () =>{
    cleanup(effectFn)
    activeEffect = effectFn
    effectStack.push(effectFn)
    const res = fn()
    effectStack.pop(effectFn)
    activeEffect = effectStack[effectStack.length - 1]
    return res
  }
  effectFn.options = options
  effectFn.deps = []
  // 非 lazy 的時候才執行
  if(!options.lazy){
    effectFn()
  }
  return effectFn
}

// 刪除與之關聯的集合
function cleanup(effectFn) {
  for(let i = 0;i < effectFn.deps.length;i++){
    const deps = effectFn.deps[i]
    deps.delete(effectFn)
  }
  effectFn.deps.length = 0
}

const data = { ok :true, text: 'hello world', bar:1, foo: 2}
const ITERATE_KEY = Symbol()

function reactive(obj) {
  return new Proxy(obj,{
    get(target,key){
      if(key === 'raw'){
        return target
      }
      track(target,key)
      return target[key]
    },
    set(target,key,newVal,receiver){
      const oldVal = target[key]
  
      // 如果屬性不存在，則說明是在添加新屬性，否則是設置已有屬性
      const type = Object.prototype.hasOwnProperty.call(target,key) ? triggerType.SET : triggerType.ADD
      // 設置屬性值
      const res = Reflect.set(target,key,newVal,receiver)
      // 新值與舊值做比較，當不全等且都不是 NaN 情況時才會觸發
      if(target === receiver.raw){
        if(oldVal !== newVal && (oldVal === oldVal || newVal === newVal)){
         trigger(target,key,type)
        }
      }
      return res
    },
    has(target,key){
      track(target,key)
      return Reflect.has(target,key)
    },
    ownKeys(target){
      track(target,ITERATE_KEY)
      return Reflect.ownKeys(target)
    },
    deleteProperty(target,key){
      const hadKey = Object.prototype.deleteProperty.call(target,key)
      const res = Reflect.deleteProperty(target,key)
  
      if(res && hadKey){
        trigger(target,key,triggerType.DELETE)
      }
      return res
    }
  })
}

// 函數追蹤變化
function track(target,key){
  if(!activeEffect) return 
  let depsMap = bucket.get(target)
  if(!depsMap) bucket.set(target, (depsMap = new Map()))
 
  let deps = depsMap.get(key)
  if(!deps) depsMap.set(key,(deps = new Set()))
  deps.add(activeEffect)
  // 與當前副作用函式存在聯繫的依賴集合
  activeEffect.deps.push(deps)
}

// 函數觸發變化
function trigger(target,key, type){
  const depsMap = bucket.get(target)
  if(!depsMap) return
  const effects = depsMap.get(key)
  // 取得與 ITERATE_KEY 相關連的副作用函式
  const iterateEffects = depsMap.get(ITERATE_KEY)

  // 創建一個新的Set，可參考 Set.prototype.forEach 會造成什麼問題
  const effectsToRun = new Set(effects)
  effects && effects.forEach(effectFn =>{
    // 如果 trigger 觸發執行的副作用函式與當前正在執行的副作用函式相同，則不進行觸發
    if(effectFn !== activeEffect){
      effectsToRun.add(effectFn)
    }
  })

  // 只有操作類型為 'ADD' 或 'DELETE' 時，才觸發與 ITERATE_KEY 相關聯的副作用函式重新執行
  if(type === triggerType.ADD || type === triggerType.DELETE){
    iterateEffects & iterateEffects.forEach(effectFn =>{
    if(effectFn !== activeEffect){
      effectsToRun.add(effectFn)
      }
    })

  }
  
  effectsToRun.forEach(effectFn => {
    // 如果存在調度器，則調用調度器，並將副作用函式作為參數傳遞
    if(effectFn.options.scheduler){
      effectFn.options.scheduler(effectFn)
    }else{
      effectFn()
    }
  })
}

// 計算屬性
function computed(getter){
  // 緩存上一次計算的值
  let value 
  // 標示是否需要重新計算值， 為 true 代表 需要計算
  let dirty = true

  const effectFn = effect(getter,{
    lazy:true,
    // 調度器中將 dirty 重置為 true ， 避免監聽的值修改了卻不會重新計算
    scheduler(){
      dirty = true
      // 當計算屬性依賴的響應式數據發生變化時，手動調用 trigger 觸發響應
      trigger(obj,'value')
    }
  })
  const obj = {
    // 當讀取 value 時才會執行 effectFn
    get value(){
      if(dirty){
        value = effectFn()
        dirty = false
      }
      // 當讀取 value 時，手動調用 track 進行追蹤
      track(obj,'value')
      return value
    }
  }

  return obj
}

function watch(source,cb,options = {}){
  let getter
  if(typeof source === 'function'){
    getter = source
  }else{
    getter = () => traverse(source)
  }

  let oldValue, newValue
  
  // cleanup 用來存儲用戶註冊的過期回調
  let cleanup
  
  // onInvalidate 函數
  function onInvalidate(fn){
    // 將過期回調存儲到 cleanup 中
    cleanup = fn
  }

  const job = () =>{
    newValue = effectFn()
    // 在回調函式 cb 之前，先調用過期回調
    if(cleanup){
      cleanup()
    }
    // 將 onInvalidate 作為回調函式的第三個參數，以便用戶使用
    cb(newValue,oldValue,onInvalidate)
    // 將舊值更新
    oldValue = newValue
  }

  const effectFn = effect(
    ()=> getter(),
    {
      lazy:true,
      scheduler: ()=>{
        if(options.flush === 'post'){
          const p = Promise.resolve()
          p.then(job)
        }else{
          job()
        }
      }
    }
  )

  if(options.immediate){
    job()
  }else{
    // 首次調用 watch 時獲取舊值
    oldValue = effectFn()
  }
}

function traverse(value,seen = new Set()){
  // 如果要讀取的數據是原始值，或者已經被讀取過了，那什麼都不做
  if(typeof value !== 'object' || value === null | seen.has(value)) return
  // 將數據添加到 seen 中， 代表遍歷讀取過了，避免循環引用引起死循環
  seen.add(value)
  for(const k in value){
    traverse(value[k],seen)
  }
  return value
}

// test 1
// effect(function effectFn () {
//   document.body.innerText = obj.ok ? obj.text : 'not'
// })
// setTimeout(()=>{
//   obj.ok = false
// },3000)
// setTimeout(() =>{
//   obj.text = 'hello vu3'
// },5000)

// test effect stack

// effect(() =>{
//   console.log('effect1')

//   effect(()=>{
//     console.log('effect2')
//     obj.foo
//   })
//   obj.bar 
// })

// obj.bar = 'test'

// test computed

const sumRes = computed(()=> obj.bar + obj.foo)
console.log(sumRes.value)